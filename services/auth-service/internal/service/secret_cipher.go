package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
)

type SecretCipher struct {
	key [32]byte
}

func NewSecretCipher(secret string) (*SecretCipher, error) {
	normalized := strings.TrimSpace(secret)
	if normalized == "" {
		return nil, fmt.Errorf("secret key is required")
	}
	return &SecretCipher{key: sha256.Sum256([]byte(normalized))}, nil
}

func (c *SecretCipher) Encrypt(plain string) (string, error) {
	if strings.TrimSpace(plain) == "" {
		return "", nil
	}

	block, err := aes.NewCipher(c.key[:])
	if err != nil {
		return "", fmt.Errorf("build aes cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("build aes-gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (c *SecretCipher) Decrypt(ciphertext string) (string, error) {
	if strings.TrimSpace(ciphertext) == "" {
		return "", nil
	}

	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(c.key[:])
	if err != nil {
		return "", fmt.Errorf("build aes cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("build aes-gcm: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, payload := raw[:nonceSize], raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt ciphertext: %w", err)
	}
	return string(plain), nil
}

func maskSecret(secret string) string {
	normalized := strings.TrimSpace(secret)
	if normalized == "" {
		return ""
	}
	if len(normalized) <= 8 {
		return "已配置"
	}
	return normalized[:4] + "••••" + normalized[len(normalized)-4:]
}
