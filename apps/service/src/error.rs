use axum::{
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProblemDetails {
    pub r#type: String,
    pub title: String,
    pub status: u16,
    pub detail: String,
    pub instance: String,
    pub code: String,
    pub correlation_id: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<Vec<FieldError>>,
    /// For a stale revision: the resource's revision now. Re-read the resource,
    /// confirm the change still applies, then send `If-Match: "revision:N"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
#[error("{detail}")]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub title: &'static str,
    pub detail: String,
    pub retryable: bool,
    pub instance: String,
    pub correlation_id: String,
    pub field_errors: Option<Vec<FieldError>>,
    pub current_revision: Option<i64>,
}

impl ApiError {
    pub fn new(
        status: StatusCode,
        code: &'static str,
        title: &'static str,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            status,
            code,
            title,
            detail: detail.into(),
            retryable: false,
            instance: String::new(),
            correlation_id: "unknown".into(),
            field_errors: None,
            current_revision: None,
        }
    }

    pub fn not_found(kind: &'static str, reference: &str) -> Self {
        let code = match kind {
            "provider" => "provider_not_found",
            "coffee" => "coffee_not_found",
            "lot" => "lot_not_found",
            "roast" => "roast_not_found",
            "brew" => "brew_not_found",
            "label" => "label_not_found",
            _ => "resource_not_found",
        };
        Self::new(
            StatusCode::NOT_FOUND,
            code,
            "Resource not found",
            format!("The requested {kind} does not exist: {reference}"),
        )
    }

    pub fn validation(detail: impl Into<String>) -> Self {
        let detail = detail.into();
        let mut error = Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_failed",
            "Validation failed",
            detail.clone(),
        );
        error.field_errors = Some(vec![FieldError {
            path: String::new(),
            code: "validation_failed".into(),
            message: detail,
        }]);
        error
    }

    pub fn revision() -> Self {
        Self::new(
            StatusCode::PRECONDITION_FAILED,
            "revision_precondition_failed",
            "Revision precondition failed",
            "This mutation requires the current If-Match revision header.",
        )
    }

    /// If-Match was missing or not a revision tag. Says exactly what to send.
    pub fn revision_header(received: Option<&str>) -> Self {
        Self::new(
            StatusCode::PRECONDITION_FAILED,
            "revision_header_invalid",
            "If-Match is not a revision tag",
            match received {
                None => "Send the resource's current revision as If-Match: \"revision:N\" (with the quotes).".to_owned(),
                Some(value) => format!(
                    "If-Match {value} is not a revision tag. Send the resource's current revision as If-Match: \"revision:N\" (with the quotes)."
                ),
            },
        )
    }

    /// Adds the resource's current revision to a revision error.
    pub fn with_current_revision(mut self, current: i64) -> Self {
        self.current_revision = Some(current);
        self
    }

    /// The revision sent is no longer current. Carries the current revision so a
    /// client can re-read the resource and decide; it is never applied implicitly.
    pub fn stale_revision(kind: &str, id: i64, sent: i64, current: i64) -> Self {
        let mut error = Self::new(
            StatusCode::PRECONDITION_FAILED,
            "revision_precondition_failed",
            "Revision precondition failed",
            format!(
                "The {kind} {id} is at revision {current}, not {sent}. Fetch it again, confirm the change still applies, then retry with If-Match: \"revision:{current}\"."
            ),
        );
        error.current_revision = Some(current);
        error
    }

    pub fn with_request(
        mut self,
        instance: impl Into<String>,
        correlation_id: impl Into<String>,
    ) -> Self {
        self.instance = instance.into();
        self.correlation_id = correlation_id.into();
        self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status;
        let body = ProblemDetails {
            r#type: format!(
                "https://tan.studio/problems/{}",
                self.code.replace('_', "-")
            ),
            title: self.title.into(),
            status: status.as_u16(),
            detail: self.detail,
            instance: self.instance,
            code: self.code.into(),
            correlation_id: self.correlation_id.clone(),
            retryable: self.retryable,
            field_errors: self.field_errors,
            current_revision: self.current_revision,
        };
        let mut response = (status, Json(body)).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/problem+json"),
        );
        if let Ok(value) = header::HeaderValue::from_str(&self.correlation_id) {
            response.headers_mut().insert("x-correlation-id", value);
        }
        response
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        tracing::error!(error = %error, "database_operation_failed");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "database_error",
            "Database error",
            "Tan Studio could not complete the database operation.",
        )
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Reads the strong entity tag `"revision:N"` from If-Match. Only that exact form
/// is accepted, so a revision is never inferred from a loosely formatted value.
pub fn expected_revision(headers: &HeaderMap) -> ApiResult<i64> {
    let value = headers.get(header::IF_MATCH).map(|value| value.to_str());
    let Some(value) = value else {
        return Err(ApiError::revision_header(None));
    };
    let Ok(value) = value else {
        return Err(ApiError::revision_header(Some("(not text)")));
    };
    value
        .strip_prefix("\"revision:")
        .and_then(|value| value.strip_suffix('"'))
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::revision_header(Some(value)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_if_match(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_MATCH, value.parse().unwrap());
        headers
    }

    #[test]
    fn if_match_accepts_only_the_strong_revision_tag() {
        assert_eq!(expected_revision(&with_if_match("\"revision:7\"")).unwrap(), 7);
        for value in ["7", "\"7\"", "revision:7", "W/\"revision:7\"", "\"revision:0\""] {
            let error = expected_revision(&with_if_match(value)).unwrap_err();
            assert_eq!(error.status, StatusCode::PRECONDITION_FAILED);
            assert_eq!(error.code, "revision_header_invalid");
            assert!(error.detail.contains("\"revision:N\""), "{value}: {}", error.detail);
            assert!(error.detail.contains(value), "{value}: {}", error.detail);
        }
        let missing = expected_revision(&HeaderMap::new()).unwrap_err();
        assert!(missing.detail.contains("\"revision:N\""));
    }

    #[test]
    fn stale_revision_reports_the_current_revision() {
        let error = ApiError::stale_revision("attachment", 4, 1, 2);
        assert_eq!(error.current_revision, Some(2));
        assert!(error.detail.contains("If-Match: \"revision:2\""));
    }
}
