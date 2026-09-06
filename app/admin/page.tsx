import type { Metadata } from "next";
import AdminDashboard from "@/components/admin-dashboard";

export const metadata: Metadata = { title: "卡密管理｜EecoHub" };
export default function AdminPage() { return <AdminDashboard />; }
