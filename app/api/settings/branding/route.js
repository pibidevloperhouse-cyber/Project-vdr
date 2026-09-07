import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
    try {
        const { action, session, payload } = await req.json();
        
        // Use payload.company_id if session is missing for fallback
        const companyId = session?.company_id || payload?.company_id;
        
        if (!companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // ─── 1. FETCH BRANDING DATA ───
        if (action === 'fetch') {
            const { data: wsData, error } = await supabase
                .from('workspace_settings')
                .select('*')
                .eq('company_id', companyId)
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            let defaultBrandName = session?.active_workspace_name || session?.workspaceName || '';
            let defaultAdminName = session?.name || '';
            let defaultAdminEmail = session?.email || '';
            let defaultAdminPhone = session?.phone || '';

            if (session?.active_workspace_id) {
                const { data: wsDetails } = await supabase
                    .from('workspaces')
                    .select('name')
                    .eq('id', session.active_workspace_id)
                    .single();
                if (wsDetails?.name) defaultBrandName = wsDetails.name;
            }

            if (session?.id) {
                const { data: userDetails } = await supabase
                    .from('users')
                    .select('name, email, phone_number')
                    .eq('id', session.id)
                    .single();
                if (userDetails) {
                    if (userDetails.name) defaultAdminName = userDetails.name;
                    if (userDetails.email) defaultAdminEmail = userDetails.email;
                    if (userDetails.phone_number) defaultAdminPhone = userDetails.phone_number;
                }
            }

            const responseData = wsData || {};
            responseData.brand_name = responseData.brand_name || defaultBrandName;
            responseData.workspace_name = defaultBrandName;
            responseData.admin_name = responseData.admin_name || defaultAdminName;
            responseData.admin_email = responseData.admin_email || defaultAdminEmail;
            responseData.admin_phone = responseData.admin_phone || defaultAdminPhone;

            return NextResponse.json({
                success: true,
                data: responseData
            });
        }

        // ─── 2. SAVE BRANDING DATA ───
        if (action === 'save') {
            let finalLogoPath = payload.logo_url;

            // If a new logo was uploaded via base64
            if (payload.logoBase64 && payload.logoName) {
                const ext = payload.logoName.split('.').pop();
                const fileName = `brand_${companyId}_${Date.now()}.${ext}`;
                const buffer = Buffer.from(payload.logoBase64, 'base64');

                const { error: uploadErr } = await supabase.storage
                    .from('vdr-logos')
                    .upload(fileName, buffer, { contentType: payload.logoMime, upsert: true });

                if (uploadErr) throw uploadErr;

                finalLogoPath = fileName;
            }

            const dbPayload = {};
            if (companyId !== undefined) dbPayload.company_id = companyId;
            if (payload.brand_name !== undefined) dbPayload.brand_name = payload.brand_name;
            if (finalLogoPath !== undefined) dbPayload.logo_url = finalLogoPath;
            if (payload.active_theme !== undefined) dbPayload.active_theme = payload.active_theme;
            if (payload.admin_name !== undefined) dbPayload.admin_name = payload.admin_name;
            if (payload.admin_email !== undefined) dbPayload.admin_email = payload.admin_email;
            if (payload.admin_phone !== undefined) dbPayload.admin_phone = payload.admin_phone;

            let resultRecordId = payload.recordId;
            
            if (resultRecordId) {
                const { error } = await supabase
                    .from('workspace_settings')
                    .update(dbPayload)
                    .eq('id', resultRecordId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase
                    .from('workspace_settings')
                    .insert(dbPayload)
                    .select()
                    .single();
                if (error) throw error;
                if (data) resultRecordId = data.id;
            }

            return NextResponse.json({ success: true, logo_url: finalLogoPath, recordId: resultRecordId });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (err) {
        console.error("Branding API Error:", err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}