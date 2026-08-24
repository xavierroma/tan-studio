# Operator signs in with Google

The public UI authenticates the operator with OpenID Connect (Sign in with Google). One allowlisted email. The API uses an HttpOnly Secure session cookie. The LAN bearer token is not injected into HTML.

Tan Bridge does not use this login. The device proves itself with its own signing key on the bridge session.
