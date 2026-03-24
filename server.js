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

  console.log('📥 Nhận request:', { ho_ten, ngay_sinh, email, sdt, orderId });

  if (!ho_ten || !ngay_sinh || !orderId) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  }

  try {
    // Gọi Apps Script bằng POST (không phải GET)
    const response = await fetch(APPS_SCRIPT_URL, {
      method:   'POST',
      redirect: 'follow',
      headers:  { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:     SECRET_TOKEN,
        ho_ten:    ho_ten,
        ngay_sinh: ngay_sinh,
        email:     email   || '',
        sdt:       sdt     || '',
        orderId:   orderId
      })
    });

    const text = await response.text();
    console.log('📤 Apps Script status:', response.status);
    console.log('📤 Apps Script response:', text.substring(0, 500));

    if (text.trim().startsWith('<')) {
      throw new Error('Apps Script trả về HTML – kiểm tra quyền deploy (phải là "Anyone")');
    }

    const data = JSON.parse(text);
    res.json(data);

  } catch (err) {
    console.error('❌ Lỗi:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi server: ' + err.message });
  }
});

// ── Trả về index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server chạy trên port ' + PORT));
