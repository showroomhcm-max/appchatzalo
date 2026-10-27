# Thêm kênh Zalo mới và đồng bộ tin nhắn cũ

Khi gắn một tài khoản Zalo vào app, Zalo chỉ cho app lấy tin **kể từ lúc gắn**. Tin cũ hơn (mặc định 90 ngày gần nhất) app lấy từ **Zalo PC** trên một máy tính đăng nhập **cùng tài khoản Zalo** với kênh. Máy đó chạy sẵn một chương trình nhỏ gọi là *máy đồng bộ*.

Tóm tắt:
- **Làm một lần cho mỗi máy tính:** cài máy đồng bộ (phần A).
- **Mỗi tài khoản Zalo mới:**
  1. quét QR trên app (B);
  2. đăng nhập Zalo PC đúng tài khoản (C);
  3. bấm **Đồng bộ tin nhắn cũ** (D).

---

## A. Cài máy đồng bộ (làm một lần cho mỗi máy tính có Zalo PC)

Cần: máy Windows có cài **Zalo PC**, và tài khoản app của anh là **Super Admin**.

1. Trên app: **Cài đặt › Kết nối kênh**, kéo xuống mục **Máy đồng bộ Zalo PC** › **Thêm máy**. Đặt tên dễ nhận (ví dụ "Laptop anh Hậu") › **Tải bộ cài**. Máy tải về file `Cai dat dong bo Zalo PC - ….zip`.
2. Trên máy có Zalo PC (mang file .zip sang nếu tải ở máy khác): chuột phải file .zip › **Giải nén tất cả** (Extract All).
3. Bấm đúp **`CAI DAT.cmd`**. Nếu Windows hỏi thì chọn **Vẫn chạy** / Run.
   - Máy chưa có Node.js thì bộ cài tự cài, mất 1–2 phút. Nếu Windows hỏi quyền quản trị thì chọn **Yes**.
4. Thấy báo **ĐÃ CÀI XONG** là xong, đóng cửa sổ được. Chương trình chạy nền và tự chạy mỗi khi mở máy.
5. Trên app, mục **Máy đồng bộ Zalo PC** hiện máy với chấm xanh **đang bật**.

> **Bộ cài chứa mã máy bí mật**, không gửi cho người ngoài; cài xong có thể xóa file .zip. Muốn cài lại hoặc chuyển sang máy khác: bấm **Bộ cài** cạnh tên máy để tải bộ mới (bộ cũ hết hiệu lực). Gỡ: bấm đúp **`GO CAI DAT.cmd`** trong bộ cài, rồi **Xóa** máy trên app.

---

## B. Thêm kênh trên app (quét QR)

1. **Cài đặt › Kết nối kênh** › nút xanh **Kết nối kênh** › **Tài khoản Zalo**. Đặt tên (ví dụ "Zalo Bảo hành") rồi tạo kênh.
2. Quét QR bằng Zalo trên điện thoại của tài khoản đó, chờ kênh báo **Đã kết nối**.
3. Gán **bộ phận được xem**, **nhân viên vào thẳng**, **tin nhắn mới vào bộ phận nào**.

Từ lúc này mọi tin mới đều về app, kể cả khi NAS tắt rồi bật lại (app tự bù tin).

---

## C. Đăng nhập Zalo PC đúng tài khoản (trên máy đồng bộ)

1. Mở **Zalo PC**. Nếu đang đăng nhập tài khoản khác: bấm avatar › **Đăng xuất**. Nếu được hỏi có xóa dữ liệu không thì chọn **giữ lại dữ liệu**.
2. Đăng nhập tài khoản của kênh bằng **quét QR** từ điện thoại.
3. Zalo PC hỏi **đồng bộ tin nhắn từ điện thoại**: bấm **Đồng bộ**, xác nhận trên điện thoại. Nếu được chọn khoảng thời gian thì chọn **ít nhất 3 tháng**.
   - Lỡ bỏ qua bước này: vào Zalo PC › **Cài đặt** › tìm mục **Đồng bộ tin nhắn**.
4. **Giữ điện thoại mở Zalo** tới khi Zalo PC báo đồng bộ xong. Mở thử vài hội thoại trên Zalo PC, thấy tin cũ là được.

> Zalo PC và app trên NAS chạy song song được, không làm nhau bị đăng xuất.

---

## D. Bấm "Đồng bộ tin nhắn cũ" trên app

1. **Cài đặt › Kết nối kênh** › bấm vào kênh › **Đồng bộ tin nhắn cũ**.
2. Dưới nút hiện tiến độ:
   - **Zalo PC: đang chờ máy có Zalo PC cùng tài khoản nhận việc…** nghĩa là việc đã giao, máy sẽ nhận trong khoảng 10 giây.
   - **máy "…" đang đọc Zalo PC: 350/992 hội thoại, đã nhập mới 46.250 tin** là đang chạy. Lúc này Zalo PC trên máy đó sẽ tắt và mở lại vài phút; đừng bấm gì trên Zalo PC.
   - **xong lúc …: nhập mới … tin trong 90 ngày gần nhất**: xong. Zalo PC tự mở lại bình thường.
3. Khoảng 100 nghìn tin mất 8–10 phút. Đóng trang trong lúc chạy cũng được: việc vẫn chạy trên máy đồng bộ, mở lại kênh là thấy tiến độ.
4. Muốn dừng thì bấm **Hủy** ngay dòng tiến độ.

Nút này cũng kéo luôn phần tin Zalo còn giữ từ lúc gắn tài khoản (dòng thông báo phía trên).

**Bấm lại nhiều lần không sao:** tin đã có tự bỏ qua, không bị trùng.

### Kiểm tra

Vào **Hội thoại**, chọn kênh vừa thêm (nút **Đã chọn … kênh** góc trên phải):
- thấy các hội thoại cũ có tên khách, ảnh đại diện, tên nhóm;
- tin chữ, ảnh, file, sticker, video, tin trích dẫn hiển thị đúng;
- tin cũ **không** làm hiện số chưa đọc và **không** bắn cảnh báo.

---

## Thông báo thường gặp

| App báo | Nghĩa là | Cách xử lý |
|---|---|---|
| Zalo PC: **chưa cài máy đồng bộ** | Chưa làm phần A | Làm phần A |
| Zalo PC: **chưa có máy đồng bộ nào đang bật** | Máy có Zalo PC đang tắt, hoặc chương trình không chạy | Bật máy đó. Chương trình tự chạy khi mở máy; nếu không, bấm đúp lại `CAI DAT.cmd` |
| Máy "…": **Zalo PC trên máy này đang đăng nhập tài khoản khác** | Zalo PC chưa đăng nhập đúng tài khoản của kênh | Làm phần C trên máy đó, bấm **Hủy** rồi **Đồng bộ tin nhắn cũ** lại |
| Máy "…": **Zalo PC chưa sẵn sàng sau 2 phút… màn hình đăng nhập** | Zalo PC chưa đăng nhập | Đăng nhập Zalo PC, bấm Hủy rồi đồng bộ lại |
| Máy "…": **Không tìm thấy chức năng sao lưu của Zalo PC (Zalo đã đổi bản?)** | Zalo PC cập nhật bản mới, đổi cấu trúc bên trong | Nhắn Claude sửa chương trình, dữ liệu không ảnh hưởng |
| **dừng giữa chừng: Máy đồng bộ mất liên lạc…** | Máy bị tắt hoặc mất mạng khi đang chạy | Bấm **Đồng bộ tin nhắn cũ** lại để làm tiếp, không bị trùng |
| Đồng bộ xong nhưng **nhập 0 tin** | Zalo PC chưa đồng bộ tin từ điện thoại | Làm lại bước C3–C4 rồi bấm đồng bộ lại |

Nhật ký của chương trình trên máy đồng bộ nằm ở `%APPDATA%\ChatSieuToc\dong-bo-zalo-pc.log`: gõ dòng này vào thanh địa chỉ File Explorer rồi Enter.

---

## Hỏi đáp

**Chương trình có gửi / xóa gì trên Zalo không?**
Không. Nó chỉ đọc, nhờ chính chức năng sao lưu có sẵn của Zalo PC, và chỉ mở cổng đọc dữ liệu trong máy (127.0.0.1) lúc đang đồng bộ. Xong là Zalo PC trở lại bình thường.

**Nhập nhầm tài khoản được không?**
Không. Máy chỉ nhận việc khi tài khoản Zalo PC trùng tài khoản của kênh, và app kiểm lại lần nữa mỗi lô tin.

**Có cần nhiều máy đồng bộ không?**
Không bắt buộc. Một máy dùng cho nhiều tài khoản được, chỉ cần đổi tài khoản Zalo PC trước khi bấm đồng bộ (phần C). Có nhiều máy thì máy nào đang mở đúng tài khoản sẽ nhận việc.

**Tin thu hồi có được nhập không?**
Không. Zalo không còn nội dung các tin này nên bỏ qua.

**Gỡ chương trình khỏi máy?**
Bấm đúp **`GO CAI DAT.cmd`** trong bộ cài (tắt chương trình, bỏ tự chạy khi mở máy), rồi **Xóa** máy trên app.

**Cách cũ bằng lệnh (chỉ trên laptop có thư mục `D:\appchatzalommz`):** `npm run nhap-zalo-pc`, thêm `-- --thu` để chỉ đếm, `-- --ngay 30` để đổi số ngày.
