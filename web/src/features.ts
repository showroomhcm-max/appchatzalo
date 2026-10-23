/**
 * Tính năng tạm ẩn (21/10/2026, chưa dùng tới): đổi thành true để hiện lại.
 * Khi hiện lại, bỏ luôn `hidden: true` của quyền tương ứng trong server/src/permissions.ts
 * (orders.create, reviews.manage) để cấp được quyền trong trang phân quyền.
 */
export const SHOW_ORDERS = false // Đơn hàng, nút Lên đơn POS, Mã khách hàng trong khung Thông tin
export const SHOW_REVIEWS = false // Chấm điểm chất lượng tư vấn (khung Thông tin, cột Điểm đánh giá ở trang Dữ liệu)
