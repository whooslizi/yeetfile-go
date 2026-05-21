package handlers

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go-localsend-usb/adbbridge"
)

type Handler struct {
	bridge *adbbridge.Bridge
	webFS  embed.FS
}

func New(bridge *adbbridge.Bridge, webFS embed.FS) *Handler {
	return &Handler{bridge: bridge, webFS: webFS}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *Handler) HandleDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := h.bridge.ListDevices()
	if err != nil {
		writeError(w, 500, fmt.Sprintf("Failed to list devices: %v", err))
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"devices":    devices,
		"quickPaths": adbbridge.QuickPaths(),
	})
}

func (h *Handler) HandleFiles(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	path := r.URL.Query().Get("path")

	if serial == "" || path == "" {
		writeError(w, 400, "Missing serial or path parameter")
		return
	}

	files, err := h.bridge.ListFiles(serial, path)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("Failed to list files: %v", err))
		return
	}

	writeJSON(w, 200, map[string]interface{}{
		"files":  files,
		"path":   path,
		"serial": serial,
	})
}

func (h *Handler) HandlePull(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	path := r.URL.Query().Get("path")

	if serial == "" || path == "" {
		writeError(w, 400, "Missing serial or path parameter")
		return
	}

	fileName := filepath.Base(path)

	ext := strings.ToLower(filepath.Ext(fileName))
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))

	if err := h.bridge.PullFile(serial, path, w); err != nil {
		log.Printf("Error pulling file %s: %v", path, err)
		// too late to send error response, we already started writing the body
		return
	}
}

func (h *Handler) HandlePush(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "Method not allowed")
		return
	}

	serial := r.FormValue("serial")
	remotePath := r.FormValue("path")

	if serial == "" || remotePath == "" {
		writeError(w, 400, "Missing serial or path parameter")
		return
	}

	// 2GB max
	if err := r.ParseMultipartForm(2 << 30); err != nil {
		writeError(w, 400, fmt.Sprintf("Failed to parse form: %v", err))
		return
	}

	results := []map[string]interface{}{}

	for _, fileHeaders := range r.MultipartForm.File {
		for _, fh := range fileHeaders {
			src, err := fh.Open()
			if err != nil {
				results = append(results, map[string]interface{}{
					"name":  fh.Filename,
					"error": err.Error(),
				})
				continue
			}

			tmpFile, err := os.CreateTemp("", "yeetsend-upload-*")
			if err != nil {
				src.Close()
				results = append(results, map[string]interface{}{
					"name":  fh.Filename,
					"error": err.Error(),
				})
				continue
			}

			if _, err := io.Copy(tmpFile, src); err != nil {
				tmpFile.Close()
				os.Remove(tmpFile.Name())
				src.Close()
				results = append(results, map[string]interface{}{
					"name":  fh.Filename,
					"error": err.Error(),
				})
				continue
			}
			tmpFile.Close()
			src.Close()

			remoteFile := remotePath
			if !strings.HasSuffix(remoteFile, "/") {
				remoteFile += "/"
			}
			remoteFile += fh.Filename

			start := time.Now()
			err = h.bridge.PushFile(serial, tmpFile.Name(), remoteFile)
			duration := time.Since(start)
			os.Remove(tmpFile.Name())

			if err != nil {
				results = append(results, map[string]interface{}{
					"name":  fh.Filename,
					"error": err.Error(),
				})
			} else {
				speed := float64(fh.Size) / duration.Seconds() / 1024 / 1024
				results = append(results, map[string]interface{}{
					"name":     fh.Filename,
					"size":     fh.Size,
					"duration": duration.String(),
					"speed":    fmt.Sprintf("%.1f MB/s", speed),
					"success":  true,
				})
			}
		}
	}

	writeJSON(w, 200, map[string]interface{}{
		"results": results,
	})
}

func (h *Handler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "Method not allowed")
		return
	}

	var req struct {
		Serial string `json:"serial"`
		Path   string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	if err := h.bridge.DeleteFile(req.Serial, req.Path); err != nil {
		writeError(w, 500, fmt.Sprintf("Failed to delete: %v", err))
		return
	}

	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

func (h *Handler) HandleThumbnail(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	path := r.URL.Query().Get("path")

	if serial == "" || path == "" {
		writeError(w, 400, "Missing serial or path parameter")
		return
	}

	ext := strings.ToLower(filepath.Ext(path))
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")

	if err := h.bridge.PullFile(serial, path, w); err != nil {
		log.Printf("Error getting thumbnail %s: %v", path, err)
		return
	}
}

func (h *Handler) HandleDeviceInfo(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		writeError(w, 400, "Missing serial parameter")
		return
	}

	devices, err := h.bridge.ListDevices()
	if err != nil {
		writeError(w, 500, fmt.Sprintf("Failed to get device info: %v", err))
		return
	}

	for _, d := range devices {
		if d.Serial == serial {
			writeJSON(w, 200, d)
			return
		}
	}

	writeError(w, 404, "Device not found")
}

func (h *Handler) HandleStorageInfo(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		writeError(w, 400, "Missing serial parameter")
		return
	}

	info, err := h.bridge.GetStorageInfo(serial)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("Failed to get storage info: %v", err))
		return
	}

	writeJSON(w, 200, info)
}

func (h *Handler) HandleMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "Method not allowed")
		return
	}

	var req struct {
		Serial string `json:"serial"`
		Path   string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	if err := h.bridge.Mkdir(req.Serial, req.Path); err != nil {
		writeError(w, 500, fmt.Sprintf("Failed to create directory: %v", err))
		return
	}

	writeJSON(w, 200, map[string]string{"status": "created"})
}

func (h *Handler) HandleStatic(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}

	subFS, err := fs.Sub(h.webFS, "web")
	if err != nil {
		http.Error(w, "Internal server error", 500)
		return
	}

	filePath := strings.TrimPrefix(path, "/")
	f, err := subFS.Open(filePath)
	if err != nil {
		// SPA fallback
		filePath = "index.html"
		f, err = subFS.Open(filePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	defer f.Close()

	content, err := io.ReadAll(f)
	if err != nil {
		http.Error(w, "Internal server error", 500)
		return
	}

	ext := filepath.Ext(filePath)
	ct := mime.TypeByExtension(ext)
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)

	w.Write(content)
}
