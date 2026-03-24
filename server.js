const express  = require('express');
const path     = require('path');
const fetch    = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const SECRET_TOKEN    = process.env.SECRET_TOKEN    || '';

// ── API trung gian ──
app.post('/api/tao-pdf', async (req, res) => {
  const { ho_ten, ngay_sinh, email, sdt, orderId } = req.body;

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  try {
    // Tạo URL với tham số
    const params = new URLSearchParams({
      token:     SECRET_TOKEN,
      ho_ten:    ho_ten,
      ngay_sinh: ngay_sinh,
      email:     email   || '',
      sdt:       sdt     || '',
      orderId:   orderId
    });

    const url = APPS_SCRIPT_URL + '?' + params.toString();
   console.log('URL đang dùng:', APPS_SCRIPT_URL);

    // node-fetch tự follow redirect
    const response = await fetch(url, {
      method:   'GET',
      redirect: 'follow',
      headers:  { 'Accept': 'application/json' }
    });

    const text = await response.text();
    console.log('Response status:', response.status);
    console.log('Response:', text.substring(0, 300));

    if (text.trim().startsWith('<')) {
      throw new Error('Apps Script trả về HTML – kiểm tra quyền deploy');
    }

    const data = JSON.parse(text);
    res.json(data);

  } catch (err) {
    console.error('Lỗi:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi server: ' + err.message });
  }
});

// ── Trả về index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server chạy trên port ' + PORT));
