use axum::{
    http::{header, StatusCode},
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
