# MT5 Python FastAPI Bridge

Cung cấp REST API lấy dữ liệu nến (OHLCV) và giá real-time từ **MetaTrader 5 (FTMO / broker)** cho Chart Viewer & Dashboard.

---

## 1. Yêu cầu hệ thống
- Hệ điều hành: **Windows** (vì thư viện `MetaTrader5` chỉ chạy trên Windows)
- Python 3.8+ (khuyên dùng Python 3.10 hoặc 3.11)
- Phần mềm **MetaTrader 5 (MT5)** đang mở và đã đăng nhập tài khoản FTMO/broker.

---

## 2. Cài đặt

Mở Terminal trong thư mục này:

```bash
cd scripts/mt5_bridge
pip install -r requirements.txt
```

---

## 3. Khởi chạy Bridge

```bash
python main.py
# hoặc
uvicorn main:app --port 8000
```

Sau khi chạy:
- API Swagger UI: http://localhost:8000/docs
- Kiểm tra kết nối: http://localhost:8000/health
- Lấy nến real-time: http://localhost:8000/candles?symbol=XAUUSD&timeframe=M5&count=300
- Lấy giá tick hiện tại: http://localhost:8000/price?symbol=XAUUSD

---

## 4. Tự động kết nối với Dashboard
Khi Node.js Chart Server (`npm run chart`) chạy trên port 3400:
- Server sẽ tự động kiểm tra `http://localhost:8000/candles`
- Nếu Bridge đang chạy và MT5 kết nối: Chart sẽ hiển thị badge **🟢 LIVE (MT5)** và tự động cập nhật nến mới nhất.
- Nếu Bridge tắt hoặc MT5 đóng: Server tự động fallback về file CSV (`data/XAUUSD_M5.csv`) và hiển thị badge **⚠️ CSV Fallback**.
