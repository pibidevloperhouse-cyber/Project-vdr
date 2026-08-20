"use client";

import React, { useState, useRef } from "react";
import { supabase } from "@/utils/supabase/client";
import { FaCloudUploadAlt, FaFileAlt } from "react-icons/fa";

export default function RedactionUploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // 'success', 'error', null
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleUpload(e.target.files[0]);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    
    setUploading(true);
    setUploadStatus(null);
    
    try {
      const raw = localStorage.getItem('vdr_session');
      if (!raw) throw new Error("Not logged in");
      const session = JSON.parse(raw);

      // Unique filename
      const filePath = `${session.company_id}/${Date.now()}_${file.name}`;
      
      // Upload to original-files bucket
      const { data, error } = await supabase.storage
        .from("original-files")
        .upload(filePath, file);

      if (error) {
        throw error;
      }

      // Insert record into documents table
      const { error: dbError } = await supabase
        .from("documents")
        .insert({
          company_id: session.company_id,
          workspace_id: session.active_workspace_id,
          uploaded_by: session.id,
          name: file.name,
          file_path: filePath,
          mime_type: file.type,
          file_size_bytes: file.size,
          is_deleted: false,
        });

      if (dbError) {
        throw dbError;
      }

      setUploadStatus('success');
      setTimeout(() => setUploadStatus(null), 3000);
      
      // Clear input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error("Upload error:", err);
      // alert the exact error so we know why it fails (e.g. RLS policy, bucket not found)
      setUploadStatus(err.message || 'Error uploading file');
      setTimeout(() => setUploadStatus(null), 5000);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col p-6 w-full h-full bg-[#FAFBFD]">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Upload Document</h1>
      
      <div className="flex-1 flex items-center justify-center">
        <div 
          className={`w-full max-w-2xl h-80 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-8 transition-colors ${
            isDragging 
              ? "border-brand bg-brand-soft" 
              : "border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
          
          {uploading ? (
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 border-4 border-slate-200 border-t-brand rounded-full animate-spin mb-4" />
              <p className="text-slate-600 font-medium text-lg">Uploading...</p>
            </div>
          ) : (
            <>
              <div className="w-20 h-20 rounded-full bg-brand-soft flex items-center justify-center mb-6">
                <FaCloudUploadAlt className="w-10 h-10 text-brand" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Drag & Drop files here</h3>
              <p className="text-slate-500 mb-6">or click to browse your computer</p>
              
              <button className="px-6 py-2.5 bg-brand text-white font-bold rounded-lg hover:bg-brand-dark transition-colors shadow-lg shadow-[var(--brand)]/20">
                Browse Files
              </button>
            </>
          )}
        </div>
      </div>
      
      {uploadStatus === 'success' && (
        <div className="fixed bottom-6 right-6 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg font-bold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          File uploaded successfully
        </div>
      )}
      
      {uploadStatus && uploadStatus !== 'success' && (
        <div className="fixed bottom-6 right-6 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg font-bold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4 z-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          {uploadStatus}
        </div>
      )}
    </div>
  );
}
