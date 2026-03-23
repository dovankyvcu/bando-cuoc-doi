const express = require('express');
const path    = require('path');
const https   = require('https');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// ================================================================
// CẤU HÌNH – điền vào đây, KHÔNG để trong file HTML
// Hoặc dùng biến môi trường Railway (khuyến nghị hơn)
// ================================================================
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'URL_APPS_SCRIPT_CUA_BAN';
const SECRET_TOKEN    = process.env.SECRET_TOKEN    || 'TOKEN_BI_MAT_CUA_BAN';
// ================================================================

// ── API TRUNG GIAN: Client gọi /api/tao-pdf thay vì gọi Apps Script trực tiếp ──
app.post('/api/tao-pdf', async (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  // Gọi Apps Script từ phía server (khách không biết URL này)
  try {
    const result = await callAppsScript({
      token:     SECRET_TOKEN,  // Token chỉ tồn tại trên server
      ho_ten,
      ngay_sinh,
      email:     email || '',
      sdt:       sdt   || '',
      orderId,
    });

    res.json(result);

  } catch (err) {
    console.error('Lỗi gọi Apps Script:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi server, vui lòng thử lại' });
  }
});

// ── Gọi Apps Script qua HTTPS ──
function callAppsScript(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url  = new URL(APPS_SCRIPT_URL);

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'text/plain',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    // Apps Script redirect nên cần follow redirect thủ công
    const req = https.request(options, (response) => {
      // Nếu redirect (302) thì follow
      if (response.statusCode === 302 && response.headers.location) {
        callAppsScriptDirect(response.headers.location, body)
          .then(resolve).catch(reject);
        return;
      }

      let raw = '';
      response.on('data', chunk => raw += chunk);
      response.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Apps Script trả về không phải JSON: ' + raw.slice(0,200))); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Follow redirect sau khi Apps Script redirect
function callAppsScriptDirect(redirectUrl, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(redirectUrl);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'text/plain',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      let raw = '';
      response.on('data', chunk => raw += chunk);
      response.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Lỗi parse JSON: ' + raw.slice(0,200))); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Serve index.html cho tất cả route còn lại ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server chạy trên port ${PORT}`));
