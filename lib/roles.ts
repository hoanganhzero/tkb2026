export function isAdminRole(role: string | null | undefined) {
  return role === "admin" || role === "super_admin";
}

export function roleLabel(role: string | null | undefined) {
  return isAdminRole(role) ? "Quản trị tối cao" : "Người dùng";
}
