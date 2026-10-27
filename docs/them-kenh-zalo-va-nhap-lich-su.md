# Thêm kênh Zalo mới và nhập lịch sử tin nhắn cũ

Khi gắn một tài khoản Zalo vào app, Zalo chỉ cho app lấy tin **kể từ lúc gắn**. Muốn thấy cả tin cũ (mặc định 90 ngày), làm thêm phần B: nhập lịch sử từ **Zalo PC** trên laptop.

Tóm tắt: **A.** quét QR trên app → **B1.** đăng nhập Zalo PC đúng tài khoản, đồng bộ tin từ điện thoại → **B2.** chạy thử → **B3.** chạy thật → **C.** kiểm tra.

Thời gian: khoảng 15–30 phút cho mỗi tài khoản. Phần lớn là chờ điện thoại đồng bộ sang Zalo PC.

---

## Cần chuẩn bị

- **Điện thoại** đang đăng nhập tài khoản Zalo cần thêm. Mở sẵn Zalo, pin trên 30%, có mạng.
- **Laptop có thư mục `D:\appchatzalommz`** (laptop đang dùng để quản lý app). Công cụ nhập chỉ chạy được trên máy này, vì cần khóa của app trong `server\data`.
- Zalo PC đã cài trên laptop.
- Tài khoản app của anh là **Super Admin**.

---

## A. Thêm kênh trên app (quét QR)

1. Mở https://cskhzalo.sieutoc.com › **Cài đặt › Kết nối kênh**.
2. Bấm nút xanh **Kết nối kênh** › chọn **Tài khoản Zalo**, đặt tên dễ nhận (ví dụ "Zalo Bảo hành") › tạo kênh.
3. App hiện mã QR. Trên điện thoại: Zalo › biểu tượng quét QR › quét mã.
4. Chờ kênh báo **Đã kết nối**. App tự đồng bộ ngay và báo "Zalo trả 0 tin" hoặc vài tin. Đây là giới hạn của Zalo, không phải lỗi.
5. Trong thẻ kênh: chọn **bộ phận được xem**, **nhân viên vào thẳng**, và **tin nhắn mới vào bộ phận nào**.

Từ lúc này mọi tin mới đều về app, kể cả khi NAS tắt rồi bật lại (app tự bù tin).

---

## B. Nhập lịch sử tin cũ từ Zalo PC

### B1. Đăng nhập Zalo PC đúng tài khoản và đồng bộ tin từ điện thoại

1. Mở **Zalo PC** trên laptop.
2. Nếu Zalo PC đang đăng nhập **tài khoản khác**:
   - bấm avatar › **Đăng xuất**;
   - nếu Zalo hỏi có xóa dữ liệu không, chọn **giữ lại dữ liệu**, để sau này đăng nhập lại tài khoản cũ không phải đồng bộ lại.
3. Đăng nhập tài khoản mới bằng **quét QR** từ điện thoại.
4. Zalo PC hỏi **đồng bộ tin nhắn từ điện thoại**: bấm **Đồng bộ**, xác nhận trên điện thoại.
   - Nếu được chọn khoảng thời gian, chọn **ít nhất 3 tháng**, hoặc toàn bộ.
   - Nếu lỡ bỏ qua bước này: Zalo PC › **Cài đặt** › tìm mục **Đồng bộ tin nhắn** để làm lại.
5. **Giữ điện thoại mở Zalo** cho đến khi Zalo PC báo đồng bộ xong. Có thể mất vài phút đến vài chục phút, tùy lượng tin.
6. Mở thử vài hội thoại trên Zalo PC, thấy tin cũ là được.

> Zalo PC và app trên NAS chạy song song được, không đá nhau. Đã thử ngày 27/10/2026.

### B2. Chạy thử (chỉ đếm, chưa nhập)

1. Mở **Terminal** (PowerShell) tại thư mục `D:\appchatzalommz`. Cách nhanh: mở thư mục trong File Explorer, gõ `powershell` vào thanh địa chỉ, nhấn Enter.
2. Chạy:
   ```
   npm run nhap-zalo-pc -- --thu
   ```
3. Zalo PC sẽ **tự tắt rồi mở lại**. Đừng bấm gì trên Zalo PC trong lúc chạy.
4. Đọc kết quả, ví dụ:
   ```
   Zalo PC đang đăng nhập tài khoản 1856419512288473150: 988 hội thoại (193 nhóm)
   XONG: đọc 98855 tin trong 285 hội thoại có tin 90 ngày gần nhất.
   ```
   Số tin hợp lý (không phải 0) là sang được bước B3.

### B3. Chạy thật

1. Cũng trong Terminal đó, chạy:
   ```
   npm run nhap-zalo-pc
   ```
2. Công cụ làm lần lượt:
   - tìm kênh trên app đang kết nối **đúng tài khoản** Zalo PC (ví dụ: `Nhập vào kênh #7 "ZALO HAU"`);
   - đọc từng hội thoại và gửi lên app, mỗi 50 hội thoại báo tiến độ một lần;
   - cuối cùng báo `Nhập mới … tin` và **mở lại Zalo PC bình thường**.
3. Thời gian: khoảng 100 nghìn tin mất 8–10 phút.
4. Nếu giữa chừng app đang cập nhật bản mới, công cụ tự đợi và thử lại, không cần làm gì.

**Tùy chọn khác:**

| Muốn | Lệnh |
|---|---|
| Nhập 30 ngày thay vì 90 | `npm run nhap-zalo-pc -- --ngay 30` |
| Nhập 1 năm | `npm run nhap-zalo-pc -- --ngay 365` |
| Chỉ định đúng kênh số 7 | `npm run nhap-zalo-pc -- --kenh 7` |

**Chạy lại lần nữa không sao:** tin đã có sẽ tự bỏ qua, không bị trùng. Dùng khi lần trước bị ngắt, hoặc muốn nhập thêm ngày.

---

## C. Kiểm tra trên app

1. Mở app › **Hội thoại**, chọn kênh vừa thêm (nút **Đã chọn … kênh** góc trên phải).
2. Thấy các hội thoại cũ có tên khách, ảnh đại diện, tên nhóm. Mở vài hội thoại thì thấy tin chữ, ảnh, file, sticker, tin trích dẫn.
3. Tin cũ **không** làm hiện số chưa đọc và **không** bắn cảnh báo.

### Sau khi xong

- Có thể đăng nhập lại Zalo PC bằng tài khoản anh hay dùng (bước B1.2).
- Có nhiều tài khoản cần nhập thì làm **lần lượt từng tài khoản**: A rồi B1 → B3 cho từng acc.

---

## Lỗi thường gặp

| Công cụ báo | Nghĩa là | Cách xử lý |
|---|---|---|
| `Không có kênh Zalo nào trên app đang kết nối tài khoản …` | Tài khoản trên Zalo PC chưa có kênh trên app, hoặc kênh đang mất kết nối | Làm phần A (quét QR), hoặc vào Kết nối kênh bấm **Kết nối lại** |
| `Zalo PC đang đăng nhập tài khoản khác với kênh …` | Đăng nhập nhầm acc trên Zalo PC (khi dùng `--kenh`) | Đăng nhập đúng tài khoản rồi chạy lại |
| `Zalo PC chưa sẵn sàng sau 2 phút … màn hình đăng nhập` | Zalo PC chưa đăng nhập | Đăng nhập Zalo PC rồi chạy lại |
| `Không tìm thấy Zalo PC` | Chưa cài Zalo PC, hoặc cài ở chỗ khác | Cài Zalo PC từ zalo.me/pc |
| `Không tìm thấy chức năng sao lưu của Zalo PC (Zalo đã đổi bản?)` | Zalo PC cập nhật bản mới, đổi cấu trúc bên trong | Nhắn Claude sửa công cụ, không ảnh hưởng dữ liệu |
| `Máy chủ chưa trả lời …, thử lại sau 30 giây` | App đang cập nhật / NAS khởi động lại | Tự xử lý, chờ. Quá 10 lần thì kiểm tra NAS (`deploy/nas/SU-CO.md`) |
| Đọc được **0 tin** | Zalo PC chưa đồng bộ tin từ điện thoại | Làm lại bước B1.4–B1.6 |
| Chạy xong mà Zalo PC không tự mở lại | Hiếm gặp | Mở Zalo PC bằng tay như bình thường |
| `npm` không chạy được | Terminal không đứng ở `D:\appchatzalommz` | Mở Terminal đúng thư mục (B2.1) |

---

## Hỏi đáp

**Công cụ có gửi / xóa gì trên Zalo không?**
Không. Công cụ chỉ đọc, nhờ chính chức năng sao lưu có sẵn của Zalo PC, và chỉ mở cổng đọc dữ liệu trong máy (127.0.0.1). Chạy xong Zalo PC trở lại bình thường.

**Tin thu hồi có được nhập không?**
Không. Zalo không còn nội dung của các tin này nên công cụ bỏ qua.

**Nhập nhầm tài khoản có sao không?**
Không nhập nhầm được: app kiểm tài khoản Zalo PC phải đúng tài khoản của kênh, sai là từ chối.

**Có cần làm lại định kỳ không?**
Không. Mỗi tài khoản chỉ cần nhập một lần lúc mới gắn vào app; từ đó tin mới tự về app.

**Nhân viên có tự làm được không?**
Hiện chỉ làm trên laptop quản lý (có khóa của app) với quyền Super Admin.
