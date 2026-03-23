const express = require('express');
const path    = require('path');
const https   = require('https');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'URL_APPS_SCRIPT_CUA_BAN';
const SECRET_TOKEN    = process.env.SECRET_TOKEN    || 'TOKEN_BI_MAT_CUA_BAN';

// ── API TRUNG GIAN ──
app.post('/api/tao-pdf', async (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  try {
    const result = await callAppsScript({
      token: SECRET_TOKEN,
      ho_ten, ngay_sinh,
      email: email || '',
      sdt:   sdt   || '',
      orderId,
    });
    res.json(result);
  } catch (err) {
    console.error('Lỗi gọi Apps Script:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi server: ' + err.message });
  }
});

// ── Gọi Apps Script qua GET – tự follow redirect ──
function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        console.log('Redirect đến:', res.headers.location);
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        console.log('Response preview:', data.substring(0, 150));
        resolve(data);
      });
    });

    req.on('error', reject);
    req.end();
  });
}
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      // Follow redirect
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        console.log('Redirect đến:', res.headers.location);
        return httpsPost(res.headers.location, body).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Apps Script response:', data.substring(0, 200));
        resolve(data);
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callAppsScript(data) {
  // Dùng GET thay vì POST – Apps Script xử lý GET tốt hơn từ server ngoài
  const params = new URLSearchParams({
    token:     data.token,
    ho_ten:    data.ho_ten,
    ngay_sinh: data.ngay_sinh,
    email:     data.email || '',
    sdt:       data.sdt   || '',
    orderId:   data.orderId,
  });

  const fullUrl = APPS_SCRIPT_URL + '?' + params.toString();
  console.log('Gọi Apps Script GET:', APPS_SCRIPT_URL);

  const raw = await httpsGet(fullUrl);

  if (raw.trim().startsWith('<')) {
    throw new Error('Apps Script trả về HTML – kiểm tra quyền truy cập');
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Lỗi parse JSON: ' + raw.substring(0, 200));
  }
}

// ── Serve index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server chạy trên port ${PORT}`));
