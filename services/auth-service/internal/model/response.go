package model

type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Details interface{} `json:"details,omitempty"`
}

func SuccessResponse(data interface{}) Response {
	return Response{
		Code:    0,
		Message: "success",
		Data:    data,
	}
}

func ErrorResponse(code int, message string, details interface{}) Response {
	return Response{
		Code:    code,
		Message: message,
		Details: details,
	}
}

// Error codes
const (
	ErrCodeInternal      = 10001
	ErrCodeBadRequest    = 10002
	ErrCodeNotFound      = 10003
	ErrCodeUnauthorized  = 10004
	ErrCodeForbidden     = 10005
	ErrCodeConflict      = 10006
	ErrCodeAPIKeyInvalid = 11001
	ErrCodeAPIKeyRevoked = 11002
	ErrCodeProjectExists = 11003
)
