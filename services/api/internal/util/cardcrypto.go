package util

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

func deriveCardCipherKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

func EncryptCardCode(code, secret string) (string, error) {
	if code == "" || secret == "" {
		return "", errors.New("empty card code or secret")
	}
	block, err := aes.NewCipher(deriveCardCipherKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(code), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func DecryptCardCode(ciphertext, secret string) (string, error) {
	if ciphertext == "" || secret == "" {
		return "", errors.New("empty ciphertext or secret")
	}
	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(deriveCardCipherKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", errors.New("invalid ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:nonceSize], raw[nonceSize:], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
