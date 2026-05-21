package main

import (
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"go-localsend-usb/adbbridge"
	"go-localsend-usb/handlers"
)

//go:embed web/*
var webFS embed.FS

func main() {
	if err := ensureADB(); err != nil {
		log.Printf("⚠️  Warning: Could not start ADB server: %v", err)
		log.Println("   Make sure 'adb' is installed and in your PATH.")
		log.Println("   The app will still start, but device features won't work until ADB is available.")
	}

	bridge := adbbridge.New()
	h := handlers.New(bridge, webFS)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/devices", h.HandleDevices)
	mux.HandleFunc("/api/files", h.HandleFiles)
	mux.HandleFunc("/api/pull", h.HandlePull)
	mux.HandleFunc("/api/push", h.HandlePush)
	mux.HandleFunc("/api/delete", h.HandleDelete)
	mux.HandleFunc("/api/thumbnail", h.HandleThumbnail)
	mux.HandleFunc("/api/device-info", h.HandleDeviceInfo)
	mux.HandleFunc("/api/storage-info", h.HandleStorageInfo)
	mux.HandleFunc("/api/mkdir", h.HandleMkdir)
	mux.HandleFunc("/", h.HandleStatic)

	port := "8080"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	fmt.Println()
	fmt.Println("  ╔══════════════════════════════════════════╗")
	fmt.Println("  ║        🔌 YeetSend USB Transfer          ║")
	fmt.Println("  ║    LocalSend but via USB • ADB Bridge     ║")
	fmt.Println("  ╠══════════════════════════════════════════╣")
	fmt.Printf("  ║  🌐 http://localhost:%-20s ║\n", port)
	fmt.Println("  ╚══════════════════════════════════════════╝")
	fmt.Println()

	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, os.Interrupt, syscall.SIGTERM)
		<-c
		fmt.Println("\n  👋 Shutting down YeetSend...")
		os.Exit(0)
	}()

	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func ensureADB() error {
	cmd := exec.Command("adb", "start-server")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
