"use client";

import { useEffect, useState, type FormEvent } from "react";
import { isAdminRole } from "../../lib/roles";

type Account = { email:string; fullName:string; school:string; role:string; licenseStatus:string; expiresAt:string };
type KeyRow = { key:string; durationDays:number; maxActivations:number; usedCount:number; status:string; createdAt:string };
type UserRow = Account & { createdAt:string };

export default function ActivationClient({ account: initial }: { account: Account }) {
  const [account,setAccount]=useState(initial);
  const [code,setCode]=useState("");
  const [message,setMessage]=useState("");
  const [keys,setKeys]=useState<KeyRow[]>([]);
  const [users,setUsers]=useState<UserRow[]>([]);
  const [days,setDays]=useState(365);
  const [max,setMax]=useState(1);
  const admin=isAdminRole(account.role);

  async function loadAdminData(){
    if(!admin)return;
    const [keyResponse,userResponse]=await Promise.all([fetch("/api/license-keys",{cache:"no-store"}),fetch("/api/admin/users",{cache:"no-store"})]);
    if(keyResponse.ok)setKeys((await keyResponse.json()).data??[]);
    if(userResponse.ok)setUsers((await userResponse.json()).data??[]);
  }
  useEffect(()=>{void loadAdminData()},[admin]);

  async function activate(e:FormEvent){
    e.preventDefault();setMessage("");
    const response=await fetch("/api/account",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({licenseKey:code})});
    const body=await response.json();
    if(response.ok){setAccount({...account,...body.data});setMessage("Kích hoạt bản quyền thành công.");setCode("");}
    else setMessage(body.error??"Kích hoạt thất bại.");
  }
  async function createKey(){
    const response=await fetch("/api/license-keys",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({durationDays:days,maxActivations:max})});
    if(response.ok){setMessage("Đã tạo mã bản quyền mới.");await loadAdminData();}
  }
  async function manageUser(email:string,action:"activate"|"deactivate"){
    const response=await fetch("/api/admin/users",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,action})});
    const body=await response.json();
    setMessage(response.ok?(action==="activate"?"Đã kích hoạt tài khoản 365 ngày.":"Đã ngừng hiệu lực tài khoản."):(body.error??"Không thể cập nhật tài khoản."));
    if(response.ok)await loadAdminData();
  }
  function copy(value:string){void navigator.clipboard.writeText(value);setMessage("Đã sao chép mã bản quyền.");}

  const active=admin||new Date(account.expiresAt)>new Date();
  return <section className="license-shell">
    <div className="license-card">
      <img className="auth-brand-image" src="/edutkb-mark.svg" alt="EduTKB"/>
      <h1>{admin?"Trung tâm quản trị":"Kích hoạt EduTKB"}</h1>
      <div className={`license-status ${active?"active":"expired"}`}>
        <b>{admin?"QUẢN TRỊ TỐI CAO":active?(account.licenseStatus==="trial"?"ĐANG DÙNG THỬ":"ĐÃ KÍCH HOẠT"):"ĐÃ HẾT HẠN"}</b>
        <span>{admin?"Toàn quyền quản lý tài khoản và bản quyền":`Hiệu lực đến ${new Date(account.expiresAt).toLocaleDateString("vi-VN")}`}</span>
      </div>
      <p><b>{account.school}</b><br/><small>{account.email}</small></p>
      {!admin&&<form onSubmit={activate}><label>Mã bản quyền<input required value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="EDUTKB-XXXX-XXXX-XXXX"/></label><button className="login-button">Kích hoạt ngay</button></form>}
      {message&&<div className="auth-message">{message}</div>}
      <a className="auth-back" href="/">Quay lại hệ thống</a>
    </div>
    {admin&&<div className="license-admin">
      <h2>Quản lý tài khoản</h2>
      <p>Kích hoạt trực tiếp 365 ngày hoặc ngừng hiệu lực tài khoản người dùng.</p>
      <div className="admin-user-list">{users.map(user=><article key={user.email}><div><b>{user.fullName}</b><small>{user.email} · {user.school}</small><em>{isAdminRole(user.role)?"Quản trị tối cao":user.licenseStatus==="active"?`Đã kích hoạt đến ${new Date(user.expiresAt).toLocaleDateString("vi-VN")}`:user.licenseStatus==="trial"?`Dùng thử đến ${new Date(user.expiresAt).toLocaleDateString("vi-VN")}`:"Đã ngừng hiệu lực"}</em></div>{!isAdminRole(user.role)&&<div><button onClick={()=>manageUser(user.email,"activate")}>Kích hoạt 365 ngày</button><button className="danger" onClick={()=>manageUser(user.email,"deactivate")}>Ngừng</button></div>}</article>)}</div>
      <h2 className="license-subheading">Mã bản quyền</h2>
      <div className="key-create"><label>Thời hạn (ngày)<input type="number" min={30} value={days} onChange={e=>setDays(Number(e.target.value))}/></label><label>Số lượt kích hoạt<input type="number" min={1} value={max} onChange={e=>setMax(Number(e.target.value))}/></label><button onClick={createKey}>Tạo mã mới</button></div>
      <div className="key-list">{keys.map(key=><article key={key.key}><div><b>{key.key}</b><small>{key.durationDays} ngày · {key.usedCount}/{key.maxActivations} lượt · {key.status}</small></div><button onClick={()=>copy(key.key)}>Sao chép</button></article>)}</div>
    </div>}
  </section>;
}
