import base64
import json

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel
from supabase import create_client, Client
from cryptography.fernet import Fernet
import uvicorn


app = FastAPI()

# 1. Supabase Secure Connection (REPLACE WITH YOUR KEYS)
URL="https://xxlawcufvetxygaqwoxi.supabase.co"
KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU"
supabase: Client = create_client(URL, KEY)

class LoginData(BaseModel):
    email: str
    password: str

# 2. API ENDPOINTS
@app.post("/api/login")
def login(data: LoginData):
    res = supabase.table("users").select("*").eq("email", data.email).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found.")
    
    user = res.data[0]
    if user["password_hash"] != data.password:
        raise HTTPException(status_code=401, detail="Invalid password.")
        
    return {"success": True, "user": user}

@app.get("/api/users/{company_id}")
def get_users(company_id: str):
    res = supabase.table("users").select("id, name, email").eq("company_id", company_id).execute()
    return {"users": res.data}


# ---------------------------------------------------------
# THE CLOUD UPLOAD ENDPOINT (Now with Extension & MIME Sniffing!)
# ---------------------------------------------------------
# ---------------------------------------------------------
# THE CLOUD UPLOAD ENDPOINT (Now 100% Synced with Next.js DB!)
# ---------------------------------------------------------
@app.post("/api/upload")
async def upload_doc(
    file: UploadFile = File(...),
    doc_name: str = Form(...),
    permissions_json: str = Form(...), 
    admin_id: str = Form(...),
    company_id: str = Form(...)
):
    try:
        # A. Generate the real encryption key
        encryption_key = Fernet.generate_key()
        cipher_suite = Fernet(encryption_key)

        # B. Read the file and convert to Base64 BEFORE encrypting
        file_bytes = await file.read()
        safe_b64_bytes = base64.b64encode(file_bytes)
        
        # 🔥 THE FIX: Calculate the exact file size in bytes for the Next.js database!
        file_size = len(file_bytes)
        
        # Encrypt the safe text
        encrypted_data = cipher_suite.encrypt(safe_b64_bytes)

        # C. Upload the encrypted bytes DIRECTLY to Supabase Storage
        safe_filename = file.filename.replace(" ", "_")
        storage_path = f"{safe_filename}.encrypted"
        
        supabase.storage.from_("vault").upload(
            path=storage_path,
            file=encrypted_data,
            file_options={"content-type": "application/octet-stream"}
        )

        original_ext = ""
        if file.filename and "." in file.filename:
            original_ext = f".{file.filename.split('.')[-1].lower()}"

        final_doc_name = doc_name if doc_name.lower().endswith(original_ext) else f"{doc_name}{original_ext}"

        # D. Save to database WITH the strict Next.js required columns
        doc_res = supabase.table("documents").insert({
            "company_id": company_id,
            "uploaded_by": admin_id,
            "name": final_doc_name,                
            "file_path": storage_path,
            "mime_type": file.content_type,        
            "file_size_bytes": file_size, # 🔥 NEXT.JS REQUIRED COLUMN ADDED
            "dek_ref": encryption_key.decode('utf-8')
        }).execute()
        
        new_doc = doc_res.data[0]
        
        # E. Assign Permissions
        permissions = json.loads(permissions_json)
        for p in permissions:
            can_read = True if p.get("can_edit") else p.get("can_read", False)
            
            supabase.table("document_permissions").insert({
                "doc_id": new_doc["id"],
                "user_id": p["user_id"],
                "can_read": can_read,
                "can_edit": p.get("can_edit", False)
            }).execute()
        
        return {"success": True}
    except Exception as e:
        print(f"Upload Error: {str(e)}") 
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------
# THE UPDATE ENDPOINT (Called by Electron when user hits "Save")
# ---------------------------------------------------------
# @app.post("/api/update")
# async def update_doc(
#     doc_id: str = Form(...),
#     user_id: str = Form(...),
#     new_b64_content: str = Form(...) 
# ):
#     try:
#         doc_res = supabase.table("documents").select("file_path, dek_ref").eq("id", doc_id).execute()
#         if not doc_res.data:
#             raise HTTPException(status_code=404, detail="Document not found")
        
#         doc = doc_res.data[0]
        
#         cipher_suite = Fernet(doc["dek_ref"].encode('utf-8'))
#         new_encrypted_data = cipher_suite.encrypt(new_b64_content.encode('utf-8'))

#         supabase.storage.from_("vault").update(
#             path=doc["file_path"],
#             file=new_encrypted_data,
#             file_options={"content-type": "application/octet-stream"}
#         )

#         supabase.table("document_edit_logs").insert({
#             "user_id": user_id,
#             "document_id": doc_id,
#             "action_type": "EDIT_AND_SAVE",
#             "metadata": {"status": "User successfully edited document values"}
#         }).execute()

#         return {"success": True}
#     except Exception as e:
#         print(f"Update Error: {str(e)}")
#         raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------
# THE UPDATE ENDPOINT (Now with Advanced Logging!)
# ---------------------------------------------------------
@app.post("/api/update")
async def update_doc(
    doc_id: str = Form(...),
    user_id: str = Form(...),
    new_b64_content: str = Form(...) 
):
    try:
        # 1. Get the document metadata to log the exact file name
        doc_res = supabase.table("documents").select("name, file_path, dek_ref").eq("id", doc_id).execute()
        if not doc_res.data:
            raise HTTPException(status_code=404, detail="Document not found")
        
        doc = doc_res.data[0]
        
        # 2. Re-encrypt the new edited content
        cipher_suite = Fernet(doc["dek_ref"].encode('utf-8'))
        new_encrypted_data = cipher_suite.encrypt(new_b64_content.encode('utf-8'))

        # 3. Overwrite the file in the Vault
        supabase.storage.from_("vault").update(
            path=doc["file_path"],
            file=new_encrypted_data,
            file_options={"content-type": "application/octet-stream"}
        )

        # 4. 🔥 THE LOGGING UPGRADE: Log exact file name and size altered
        supabase.table("document_edit_logs").insert({
            "user_id": user_id,
            "document_id": doc_id,
            "action_type": "EDIT_DOCUMENT",
            "metadata": {
                "file_name": doc["name"],
                "status": "Successfully Updated",
                "bytes_updated": len(new_b64_content)
            }
        }).execute()

        return {"success": True}
    except Exception as e:
        print(f"Update Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/{user_id}")
def get_files(user_id: str):
    res = supabase.table("document_permissions").select("doc_id, documents(id, name)").eq("user_id", user_id).eq("can_read", True).execute()
    return {"files": res.data}

@app.get("/api/download/{doc_id}/{doc_name}")
def download_vdr(doc_id: str, doc_name: str):
    # Generates the .vdr "access token" file for the Electron app to read
    clean_name = doc_name.replace(" ", "_")
    headers = {'Content-Disposition': f'attachment; filename="{clean_name}.vdr"'}
    return PlainTextResponse(content=doc_id, headers=headers)

@app.get("/")
def serve_ui():
    return FileResponse("index.html")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)








# import base64
# import json # <-- UNCOMMENTED THIS! You need it for json.loads() below

# from fastapi import FastAPI, HTTPException, UploadFile, File, Form
# from fastapi.responses import FileResponse, PlainTextResponse
# from pydantic import BaseModel
# from supabase import create_client, Client
# from cryptography.fernet import Fernet
# import uvicorn


# app = FastAPI()

# # 1. Supabase Secure Connection (REPLACE WITH YOUR KEYS)
# URL = "https://rkrcemzisyoaewocqtlh.supabase.co"
# KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcmNlbXppc3lvYWV3b2NxdGxoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDEzMDM5NywiZXhwIjoyMDk1NzA2Mzk3fQ.BG7fHku_h5mAQIfyRyqm9fqNwgO4UporHxYMPFNEBvY"
# supabase: Client = create_client(URL, KEY)

# class LoginData(BaseModel):
#     email: str
#     password: str

# # 2. API ENDPOINTS
# @app.post("/api/login")
# def login(data: LoginData):
#     res = supabase.table("users").select("*").eq("email", data.email).execute()
#     if not res.data:
#         raise HTTPException(status_code=404, detail="User not found.")
    
#     user = res.data[0]
#     if user["password_hash"] != data.password:
#         raise HTTPException(status_code=401, detail="Invalid password.")
        
#     return {"success": True, "user": user}

# @app.get("/api/users/{company_id}")
# def get_users(company_id: str):
#     res = supabase.table("users").select("id, name, email").eq("company_id", company_id).execute()
#     return {"users": res.data}

# # THE CLOUD UPLOAD ENDPOINT
# @app.post("/api/upload")
# async def upload_doc(
#     file: UploadFile = File(...),
#     doc_name: str = Form(...),
#     permissions_json: str = Form(...), # Accepts the JSON array of checked users
#     admin_id: str = Form(...),
#     company_id: str = Form(...)
# ):
#     try:
#         # A. Generate the real encryption key
#         encryption_key = Fernet.generate_key()
#         cipher_suite = Fernet(encryption_key)

#         # B. Read the file and convert to Base64 BEFORE encrypting
#         file_bytes = await file.read()
        
#         # 🔥 THE FIX IS HERE: Convert to Base64 to prevent the UTF-8 crash in Electron
#         safe_b64_bytes = base64.b64encode(file_bytes)
        
#         # Encrypt the safe text, not the raw binary!
#         encrypted_data = cipher_suite.encrypt(safe_b64_bytes)

#         # C. Upload the encrypted bytes DIRECTLY to Supabase Storage
#         safe_filename = file.filename.replace(" ", "_")
#         storage_path = f"{safe_filename}.encrypted"
        
#         supabase.storage.from_("vault").upload(
#             path=storage_path,
#             file=encrypted_data,
#             file_options={"content-type": "application/octet-stream"}
#         )

#         # D. Save to database using the custom Document Name
#         doc_res = supabase.table("documents").insert({
#             "company_id": company_id,
#             "uploaded_by": admin_id,
#             "name": doc_name, # Use the nice name the admin typed
#             "file_path": storage_path,
#             "dek_ref": encryption_key.decode('utf-8')
#         }).execute()
        
#         new_doc = doc_res.data[0]
        
#         # E. The Upgrade: Loop through the checked users and assign access!
#         permissions = json.loads(permissions_json)
#         for p in permissions:
#             # If they can edit, we automatically guarantee they can read
#             can_read = True if p.get("can_edit") else p.get("can_read", False)
            
#             supabase.table("document_permissions").insert({
#                 "doc_id": new_doc["id"],
#                 "user_id": p["user_id"],
#                 "can_read": can_read,
#                 "can_edit": p.get("can_edit", False)
#             }).execute()
        
#         return {"success": True}
#     except Exception as e:
#         print(f"Upload Error: {str(e)}") 
#         raise HTTPException(status_code=500, detail=str(e))

# @app.get("/api/files/{user_id}")
# def get_files(user_id: str):
#     res = supabase.table("document_permissions").select("doc_id, documents(id, name)").eq("user_id", user_id).eq("can_read", True).execute()
#     return {"files": res.data}

# @app.get("/api/download/{doc_id}/{doc_name}")
# def download_vdr(doc_id: str, doc_name: str):
#     # Generates the .vdr "access token" file for the Electron app to read
#     clean_name = doc_name.replace(" ", "_")
#     headers = {'Content-Disposition': f'attachment; filename="{clean_name}.vdr"'}
#     return PlainTextResponse(content=doc_id, headers=headers)

# @app.get("/")
# def serve_ui():
#     return FileResponse("index.html")

# if __name__ == "__main__":
#     uvicorn.run(app, host="127.0.0.1", port=8000)













 # import json

# from fastapi import FastAPI, HTTPException, UploadFile, File, Form
# from fastapi.responses import FileResponse, PlainTextResponse
# from pydantic import BaseModel
# from supabase import create_client, Client
# from cryptography.fernet import Fernet
# import uvicorn


# app = FastAPI()

# # 1. Supabase Secure Connection (REPLACE WITH YOUR KEYS)
# URL = "https://rkrcemzisyoaewocqtlh.supabase.co"
# KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcmNlbXppc3lvYWV3b2NxdGxoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDEzMDM5NywiZXhwIjoyMDk1NzA2Mzk3fQ.BG7fHku_h5mAQIfyRyqm9fqNwgO4UporHxYMPFNEBvY"
# supabase: Client = create_client(URL, KEY)

# class LoginData(BaseModel):
#     email: str
#     password: str

# # 2. API ENDPOINTS
# @app.post("/api/login")
# def login(data: LoginData):
#     res = supabase.table("users").select("*").eq("email", data.email).execute()
#     if not res.data:
#         raise HTTPException(status_code=404, detail="User not found.")
    
#     user = res.data[0]
#     if user["password_hash"] != data.password:
#         raise HTTPException(status_code=401, detail="Invalid password.")
        
#     return {"success": True, "user": user}

# @app.get("/api/users/{company_id}")
# def get_users(company_id: str):
#     res = supabase.table("users").select("id, name, email").eq("company_id", company_id).execute()
#     return {"users": res.data}

# # THE CLOUD UPLOAD ENDPOINT
# @app.post("/api/upload")
# async def upload_doc(
#     file: UploadFile = File(...),
#     doc_name: str = Form(...),
#     permissions_json: str = Form(...), # Accepts the JSON array of checked users
#     admin_id: str = Form(...),
#     company_id: str = Form(...)
# ):
#     try:
#         # A. Generate the real encryption key
#         encryption_key = Fernet.generate_key()
#         cipher_suite = Fernet(encryption_key)

#         # B. Read the file and encrypt its physical bytes
#         file_bytes = await file.read()
#         encrypted_data = cipher_suite.encrypt(file_bytes)

#         # C. Upload the encrypted bytes DIRECTLY to Supabase Storage
#         safe_filename = file.filename.replace(" ", "_")
#         storage_path = f"{safe_filename}.encrypted"
        
#         supabase.storage.from_("vault").upload(
#             path=storage_path,
#             file=encrypted_data,
#             file_options={"content-type": "application/octet-stream"}
#         )

#         # D. Save to database using the custom Document Name
#         doc_res = supabase.table("documents").insert({
#             "company_id": company_id,
#             "uploaded_by": admin_id,
#             "name": doc_name, # Use the nice name the admin typed
#             "file_path": storage_path,
#             "dek_ref": encryption_key.decode('utf-8')
#         }).execute()
        
#         new_doc = doc_res.data[0]
        
#         # E. The Upgrade: Loop through the checked users and assign access!
#         permissions = json.loads(permissions_json)
#         for p in permissions:
#             # If they can edit, we automatically guarantee they can read
#             can_read = True if p.get("can_edit") else p.get("can_read", False)
            
#             supabase.table("document_permissions").insert({
#                 "doc_id": new_doc["id"],
#                 "user_id": p["user_id"],
#                 "can_read": can_read,
#                 "can_edit": p.get("can_edit", False)
#             }).execute()
        
#         return {"success": True}
#     except Exception as e:
#         print(f"Upload Error: {str(e)}") 
#         raise HTTPException(status_code=500, detail=str(e))

# @app.get("/api/files/{user_id}")
# def get_files(user_id: str):
#     res = supabase.table("document_permissions").select("doc_id, documents(id, name)").eq("user_id", user_id).eq("can_read", True).execute()
#     return {"files": res.data}

# @app.get("/api/download/{doc_id}/{doc_name}")
# def download_vdr(doc_id: str, doc_name: str):
#     # Generates the .vdr "access token" file for the Electron app to read
#     clean_name = doc_name.replace(" ", "_")
#     headers = {'Content-Disposition': f'attachment; filename="{clean_name}.vdr"'}
#     return PlainTextResponse(content=doc_id, headers=headers)

# @app.get("/")
# def serve_ui():
#     return FileResponse("index.html")

# if __name__ == "__main__":
#     uvicorn.run(app, host="127.0.0.1", port=8000)