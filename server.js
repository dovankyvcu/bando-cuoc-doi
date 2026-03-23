const express = require('express');
const path    = require('path');
const https   = require('https');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const SECRET_TOKEN    = process.env.SECRET_TOKEN    || '';

// API trung gian – client gọi vào đây
app.post('/api/tao-pdf', async (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  try {
    const result = await goiAppsScript(ho_ten, ngay_sinh, email, sdt, orderId);
    res.json(result);
  } catch (err) {
    console.error('Lỗi:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi server: ' + err.message });
  }
});

// Gọi Apps Script qua GET request
function goiAppsScript(ho_ten, ngay_sinh, email, sdt, orderId) {
  return new Promise(function(resolve, reject) {
    var params = new URLSearchParams({
      token:     SECRET_TOKEN,
      ho_ten:    ho_ten,
      ngay_sinh: ngay_sinh,
      email:     email || '',
      sdt:       sdt   || '',
      orderId:   orderId
    });

    var fullUrl = APPS_SCRIPT_URL + '?' + params.toString();
    console.log('Gọi Apps Script:', APPS_SCRIPT_URL);

    layDuLieu(fullUrl, resolve, reject, 0);
  });
}

// Tải dữ liệu từ URL, tự follow redirect
function layDuLieu(urlStr, resolve, reject, depth) {
  if (depth > 5) {
    reject(new Error('Quá nhiều redirect'));
    return;
  }

  var url = new URL(urlStr);
  var options = {
    hostname: url.hostname,
    path:     url.pathname + url.search,
    method:   'GET',
    headers:  { 'Accept': 'application/json' }
  };

  var req = https.request(options, function(res) {
    var location = res.headers.location;

    // Follow redirect
    if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && location) {
      console.log('Redirect tới:', location);
      layDuLieu(location, resolve, reject, depth + 1);
      return;
    }

    var data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      console.log('Status:', res.statusCode);
      console.log('Response:', data.substring(0, 200));

      if (data.trim().startsWith('<')) {
        reject(new Error('Apps Script trả về HTML – kiểm tra quyền deploy'));
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch(e) {
        reject(new Error('Lỗi JSON: ' + data.substring(0, 100)));
      }
    });
  });

  req.on('error', reject);
  req.end();
}

// Trả về index.html cho mọi route
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server chạy trên port ' + PORT);
});
