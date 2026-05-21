package adbbridge

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
	Mode    string `json:"mode"`
}

type DeviceInfo struct {
	Serial      string `json:"serial"`
	State       string `json:"state"`
	Model       string `json:"model"`
	Product     string `json:"product"`
	Device      string `json:"device"`
	Transport   string `json:"transport"`
	AndroidVer  string `json:"androidVersion"`
	SDK         string `json:"sdk"`
	Brand       string `json:"brand"`
	Fingerprint string `json:"fingerprint"`
}

type StorageInfo struct {
	Total     int64  `json:"total"`
	Used      int64  `json:"used"`
	Available int64  `json:"available"`
	MountPoint string `json:"mountPoint"`
}

type Bridge struct {
	adbPath string
}

func New() *Bridge {
	adbPath, err := exec.LookPath("adb")
	if err != nil {
		adbPath = "adb" // will error when actually used
	}
	return &Bridge{adbPath: adbPath}
}

func (b *Bridge) ListDevices() ([]DeviceInfo, error) {
	out, err := b.exec("devices", "-l")
	if err != nil {
		return nil, fmt.Errorf("adb devices: %w", err)
	}

	var devices []DeviceInfo
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "List of") || strings.TrimSpace(line) == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		dev := DeviceInfo{
			Serial: parts[0],
			State:  parts[1],
		}

		for _, p := range parts[2:] {
			kv := strings.SplitN(p, ":", 2)
			if len(kv) != 2 {
				continue
			}
			switch kv[0] {
			case "model":
				dev.Model = kv[1]
			case "product":
				dev.Product = kv[1]
			case "device":
				dev.Device = kv[1]
			case "transport_id":
				dev.Transport = kv[1]
			}
		}

		// grab extra props if the device is actually online
		if dev.State == "device" {
			dev.AndroidVer = b.getProp(dev.Serial, "ro.build.version.release")
			dev.SDK = b.getProp(dev.Serial, "ro.build.version.sdk")
			dev.Brand = b.getProp(dev.Serial, "ro.product.brand")
			dev.Fingerprint = b.getProp(dev.Serial, "ro.build.fingerprint")
		}

		devices = append(devices, dev)
	}

	return devices, nil
}

func (b *Bridge) ListFiles(serial, remotePath string) ([]FileInfo, error) {
	out, err := b.execDevice(serial, "shell", "ls", "-la", remotePath)
	if err != nil {
		return nil, fmt.Errorf("ls %s: %w", remotePath, err)
	}

	var files []FileInfo
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "total") || strings.TrimSpace(line) == "" {
			continue
		}

		fi := parseLsLine(line, remotePath)
		if fi != nil && fi.Name != "." && fi.Name != ".." {
			files = append(files, *fi)
		}
	}

	return files, nil
}

func (b *Bridge) PullFile(serial, remotePath string, w io.Writer) error {
	cmd := exec.Command(b.adbPath, "-s", serial, "exec-out", "cat", remotePath)
	cmd.Stdout = w
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func (b *Bridge) PullFileToPath(serial, remotePath, localPath string) error {
	dir := filepath.Dir(localPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	_, err := b.execDevice(serial, "pull", remotePath, localPath)
	return err
}

func (b *Bridge) PushFile(serial, localPath, remotePath string) error {
	_, err := b.execDevice(serial, "push", localPath, remotePath)
	return err
}

func (b *Bridge) PushReader(serial string, r io.Reader, remotePath string, size int64) error {
	// gotta dump to a temp file first since adb push needs a real path
	tmpFile, err := os.CreateTemp("", "yeetsend-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	if _, err := io.Copy(tmpFile, r); err != nil {
		return err
	}
	tmpFile.Close()

	return b.PushFile(serial, tmpFile.Name(), remotePath)
}

func (b *Bridge) DeleteFile(serial, remotePath string) error {
	_, err := b.execDevice(serial, "shell", "rm", "-rf", remotePath)
	return err
}

func (b *Bridge) GetThumbnail(serial, remotePath string) ([]byte, error) {
	// just pull the whole file, let the frontend deal with resizing
	cmd := exec.Command(b.adbPath, "-s", serial, "exec-out", "cat", remotePath)
	return cmd.Output()
}

func (b *Bridge) GetStorageInfo(serial string) ([]StorageInfo, error) {
	out, err := b.execDevice(serial, "shell", "df", "-h", "/sdcard")
	if err != nil {
		return nil, err
	}

	var infos []StorageInfo
	scanner := bufio.NewScanner(strings.NewReader(out))
	first := true
	for scanner.Scan() {
		if first {
			first = false
			continue // skip the header row
		}
		line := scanner.Text()
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}
		infos = append(infos, StorageInfo{
			Total:      parseSize(parts[1]),
			Used:       parseSize(parts[2]),
			Available:  parseSize(parts[3]),
			MountPoint: parts[len(parts)-1],
		})
	}

	return infos, nil
}

func (b *Bridge) Mkdir(serial, remotePath string) error {
	_, err := b.execDevice(serial, "shell", "mkdir", "-p", remotePath)
	return err
}

func (b *Bridge) FileExists(serial, remotePath string) bool {
	_, err := b.execDevice(serial, "shell", "test", "-e", remotePath, "&&", "echo", "yes")
	return err == nil
}

func (b *Bridge) GetFileSize(serial, remotePath string) (int64, error) {
	out, err := b.execDevice(serial, "shell", "stat", "-c", "%s", remotePath)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(out), 10, 64)
}

func (b *Bridge) exec(args ...string) (string, error) {
	cmd := exec.Command(b.adbPath, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (b *Bridge) execDevice(serial string, args ...string) (string, error) {
	fullArgs := append([]string{"-s", serial}, args...)
	return b.exec(fullArgs...)
}

func (b *Bridge) getProp(serial, prop string) string {
	out, err := b.execDevice(serial, "shell", "getprop", prop)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// parse a line from `ls -la` output
// example: drwxrwx--x 2 root sdcard_r 4096 2024-01-15 10:30 DCIM
// example: -rw-rw---- 1 root sdcard_r 1234567 2024-01-15 10:30 photo.jpg
func parseLsLine(line, parentPath string) *FileInfo {
	parts := strings.Fields(line)
	if len(parts) < 7 {
		return nil
	}

	mode := parts[0]
	isDir := strings.HasPrefix(mode, "d") || strings.HasPrefix(mode, "l")

	var name string
	var size int64
	var dateStr string

	if len(parts) >= 8 {
		size, _ = strconv.ParseInt(parts[4], 10, 64)
		dateStr = parts[5] + " " + parts[6]
		name = strings.Join(parts[7:], " ")
	} else {
		name = parts[len(parts)-1]
	}

	// strip symlink targets
	if idx := strings.Index(name, " -> "); idx != -1 {
		name = name[:idx]
	}

	if name == "" {
		return nil
	}

	fullPath := parentPath
	if !strings.HasSuffix(fullPath, "/") {
		fullPath += "/"
	}
	fullPath += name

	return &FileInfo{
		Name:    name,
		Path:    fullPath,
		IsDir:   isDir,
		Size:    size,
		ModTime: dateStr,
		Mode:    mode,
	}
}

func parseSize(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}

	multiplier := int64(1)
	s = strings.ToUpper(s)

	if strings.HasSuffix(s, "T") {
		multiplier = 1024 * 1024 * 1024 * 1024
		s = s[:len(s)-1]
	} else if strings.HasSuffix(s, "G") {
		multiplier = 1024 * 1024 * 1024
		s = s[:len(s)-1]
	} else if strings.HasSuffix(s, "M") {
		multiplier = 1024 * 1024
		s = s[:len(s)-1]
	} else if strings.HasSuffix(s, "K") {
		multiplier = 1024
		s = s[:len(s)-1]
	}

	val, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}

	return int64(val * float64(multiplier))
}

func QuickPaths() []struct {
	Name string
	Path string
	Icon string
} {
	return []struct {
		Name string
		Path string
		Icon string
	}{
		{"📸 DCIM (Camera)", "/sdcard/DCIM", "📸"},
		{"🖼️ Pictures", "/sdcard/Pictures", "🖼️"},
		{"📥 Downloads", "/sdcard/Download", "📥"},
		{"🎵 Music", "/sdcard/Music", "🎵"},
		{"🎬 Movies", "/sdcard/Movies", "🎬"},
		{"📄 Documents", "/sdcard/Documents", "📄"},
		{"📱 Internal Storage", "/sdcard", "📱"},
	}
}

func FormatTime(t time.Time) string {
	return t.Format("2006-01-02 15:04:05")
}
