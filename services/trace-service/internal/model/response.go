package model

// Response is the standard API response envelope.
type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func SuccessResponse(data interface{}) Response {
	return Response{Code: 0, Message: "success", Data: data}
}

func ErrorResponse(code int, message string) Response {
	return Response{Code: code, Message: message}
}
