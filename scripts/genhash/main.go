package main

import (
	"crypto/sha256"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	admin, _ := bcrypt.GenerateFromPassword([]byte("admin123"), 10)
	demo, _ := bcrypt.GenerateFromPassword([]byte("demo123"), 10)
	card := sha256.Sum256([]byte("STARAI-DEMO-1000"))
	fmt.Printf("admin: %s\n", admin)
	fmt.Printf("demo: %s\n", demo)
	fmt.Printf("card: %x\n", card)
}
