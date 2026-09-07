"use client";

import React, { useState, useMemo, useRef, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { FaEye, FaEdit, FaUpload, FaShieldAlt, FaDownload, FaTrash, FaGripVertical } from 'react-icons/fa';
import BulkUploadModal from '@/components/documents/BulkUploadModal';
import { exportIndexToExcel, exportIndexToPDF } from '@/utils/exportIndexService';

export default function DocumentsPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center w-full h-full bg-[#FAFBFD]"><div className="w-8 h-8 border-4 border-slate-200 border-t-brand rounded-full animate-spin" /></div>}>
            <UnifiedWorkspace />
        </Suspense>
    );
}

function UnifiedWorkspace() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const currentView = searchParams.get('view') || 'files';
    const [session, setSession] = useState(null);

    // Core Data
    const [files, setFiles] = useState([]);
    const [mergedPerms, setMergedPerms] = useState({});
    const [globalFolderPerms, setGlobalFolderPerms] = useState({ can_create: false, can_merge: false, can_delete: false });

    // UI State
    const [loading, setLoading] = useState(true);
    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [deletedIds, setDeletedIds] = useState(new Set());
    const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
    const [downloadedIds, setDownloadedIds] = useState(new Set());
    const [downloading, setDownloading] = useState({});
    const [toast, setToast] = useState(null);
    const [isDraggingOverScreen, setIsDraggingOverScreen] = useState(false);
    const [retentionDays, setRetentionDays] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('vdr_trash_retention_days');
            return saved ? parseInt(saved, 10) : 30;
        }
        return 30;
    });

    // Modals & Dropdowns
    const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
    const [isExportIndexMenuOpen, setIsExportIndexMenuOpen] = useState(false);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isPermDeleteModalOpen, setIsPermDeleteModalOpen] = useState(false);
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [movingToFolderId, setMovingToFolderId] = useState(null);
    const [uploadQueue, setUploadQueue] = useState([]);
    const [initialUploadFiles, setInitialUploadFiles] = useState([]);
    const [dragMode, setDragMode] = useState(null);

    const fileInputRef = useRef(null);

    // ── SESSION ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const raw = localStorage.getItem('vdr_session');
        if (!raw) { router.push('/login'); return; }
        setSession(JSON.parse(raw));
    }, [router]);

    // ── SMART FETCH (CALLS THE BACKEND API) ──────────────────────────────────
    const loadData = async (userSession) => {
        setLoading(true);
        try {
            const res = await fetch('/api/documents/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: userSession || session })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            setFiles(data.files);
            setMergedPerms(data.mergedPerms);
            setGlobalFolderPerms(data.globalFolderPerms);

            setBookmarkedIds(new Set(data.files.filter(f => f.is_bookmarked).map(f => f.id)));
            setDownloadedIds(new Set(data.files.filter(f => f.is_downloaded).map(f => f.id)));
            const newDeletedIds = new Set(data.files.filter(f => f.is_deleted).map(f => f.id));
            setDeletedIds(newDeletedIds);
            
            return { files: data.files, deletedIds: newDeletedIds };
        } catch (err) {
            console.error('Fetch error:', err);
            return null;
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (session) loadData(session); }, [session]);

    // ── ACTION API HELPER ────────────────────────────────────────────────────
    const executeBackendAction = async (action, payload) => {
        const res = await fetch('/api/documents/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, payload, session })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        return data;
    };

    // ── UTILITIES ────────────────────────────────────────────────────────────
    const formatBytes = (bytes) => {
        if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '--';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const canUser = (action, item = null) => {
        if (!session) return false;
        if (session.role === 'super_admin') return true;
        if (!item) {
            if (action === 'can_upload' && currentFolderId === null) return false;
            if (action === 'can_export') return false;
            return false;
        }
        if (item.creator_id === session.id && item.creator_revoked !== true) return true;
        const key = item.type === 'folder' ? `fol_${item.id}` : `doc_${item.id}`;
        return mergedPerms[key]?.[action] === true;
    };

    // ── SORTING & INDEXING (Standard VDR Hierarchical Engine) ────────────────
    const getActiveDisplayIndex = useCallback((f) => {
        if (!f) return '—';

        // 1. If it's a folder, recursively traverse parent folders to build hierarchical index e.g. 1.2.1
        if (f.type === 'folder') {
            const path = [];
            let curr = f;
            let depth = 0;
            while (curr && depth < 10) {
                path.unshift((curr.index || '1').toString().trim());
                if (!curr.parentId || curr.parentId === 'root') break;
                curr = files.find(x => x.id === curr.parentId);
                depth++;
            }
            return path.join('.') || '—';
        }

        // 2. If it's a document:
        // Case A: If doc already has a full dotted index (e.g. "1.1", "1.2.3") and not '99', use it
        if (f.index && f.index !== '99' && f.index.toString().includes('.')) {
            return f.index.toString().trim();
        }

        // Case B: If doc is in a parent folder, resolve parent folder's hierarchical index + doc suffix
        if (f.parentId && f.parentId !== 'root') {
            const parentFolder = files.find(x => x.id === f.parentId);
            if (parentFolder) {
                const parentPath = [];
                let curr = parentFolder;
                let depth = 0;
                while (curr && depth < 10) {
                    parentPath.unshift((curr.index || '1').toString().trim());
                    if (!curr.parentId || curr.parentId === 'root') break;
                    curr = files.find(x => x.id === curr.parentId);
                    depth++;
                }
                const parentPrefix = parentPath.join('.');
                const docSuffix = (f.index && f.index !== '99') ? f.index.toString().split('.').pop() : '1';
                return parentPrefix ? `${parentPrefix}.${docSuffix}` : docSuffix;
            }
        }

        // Case C: Root document
        return f.index && f.index !== '99' ? f.index.toString().trim() : '1';
    }, [files]);

    const getLocationPath = useCallback((f) => {
        if (!f || !f.parentId || f.parentId === 'root') return '/';
        const pathNames = [];
        let curr = files.find(x => x.id === f.parentId);
        let depth = 0;
        while (curr && depth < 10) {
            pathNames.unshift(curr.name);
            if (!curr.parentId || curr.parentId === 'root') break;
            curr = files.find(x => x.id === curr.parentId);
            depth++;
        }
        return pathNames.length > 0 ? `/${pathNames.join('/')}` : '/';
    }, [files]);

    const sortItemsByIndex = useCallback((a, b) => {
        const isAFolder = a.type === 'folder';
        const isBFolder = b.type === 'folder';
        
        // In active files view, folders appear first. In trash, sort purely by hierarchical index
        if (currentView !== 'trash') {
            if (isAFolder && !isBFolder) return -1;
            if (!isAFolder && isBFolder) return 1;
        }

        const compareIndexes = (idxA, idxB) => {
            const partsA = (idxA || '999999').toString().split('.').map(n => parseInt(n, 10) || 0);
            const partsB = (idxB || '999999').toString().split('.').map(n => parseInt(n, 10) || 0);
            const len = Math.max(partsA.length, partsB.length);
            for (let i = 0; i < len; i++) {
                const numA = partsA[i] || 0;
                const numB = partsB[i] || 0;
                if (numA !== numB) return numA - numB;
            }
            return (idxA || '').toString().localeCompare((idxB || '').toString());
        };

        const idxCmp = compareIndexes(a.displayIndex || a.index, b.displayIndex || b.index);
        if (idxCmp !== 0) return idxCmp;
        return a.name.localeCompare(b.name);
    }, [currentView]);

    const currentItems = useMemo(() => {
        const raw = (() => {
            if (currentView === 'trash') return files.filter(f => deletedIds.has(f.id));
            if (currentView === 'bookmarks') return files.filter(f => bookmarkedIds.has(f.id) && !deletedIds.has(f.id));
            if (currentView === 'downloads') return files.filter(f => downloadedIds.has(f.id) && !deletedIds.has(f.id));
            return files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
        })();
        return raw.map(f => ({ 
            ...f, 
            displayIndex: getActiveDisplayIndex(f),
            locationPath: getLocationPath(f)
        }));
    }, [currentFolderId, files, currentView, deletedIds, bookmarkedIds, downloadedIds, getActiveDisplayIndex, getLocationPath]);

    const filteredItems = useMemo(() => {
        return currentItems.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase())).sort(sortItemsByIndex);
    }, [currentItems, searchQuery, sortItemsByIndex]);

    const breadcrumbPath = useMemo(() => {
        const path = []; let id = currentFolderId;
        while (id !== null) {
            const folder = files.find(f => f.id === id);
            if (folder) { path.unshift(folder); id = folder.parentId; } else break;
        }
        return path;
    }, [currentFolderId, files]);

    // ── EVENT HANDLERS (Hitting Backend API) ─────────────────────────────────
    const handleToggleSelect = (id, e) => {
        e.stopPropagation();
        setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    };

    const handleSelectAll = () => setSelectedIds(prev => prev.size === filteredItems.length ? new Set() : new Set(filteredItems.map(f => f.id)));

    const handleToggleBookmark = async (item, e) => {
        e.stopPropagation();
        try {
            const isBookmarked = bookmarkedIds.has(item.id);
            await executeBackendAction('bookmark', { id: item.id, itemType: item.type, isBookmarked });
            setBookmarkedIds(prev => { const n = new Set(prev); isBookmarked ? n.delete(item.id) : n.add(item.id); return n; });
        } catch (err) { showToast('Bookmark failed', 'error'); }
    };

    const handleCreateFolder = async (e) => {
        e.preventDefault();
        if (!newFolderName.trim()) return;
        try {
            const peers = files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
            let newIndex = peers.reduce((m, it) => {
                const lastPart = it.index ? it.index.toString().split('.').pop() : '0';
                return Math.max(m, parseInt(lastPart) || 0);
            }, 0) + 1;

            await executeBackendAction('create_folder', { parentId: currentFolderId, name: newFolderName.trim(), index: newIndex });
            await loadData();
            // Auto-reindex: ensures new folder fits perfectly in sequence
            await executeRebuildIndex();
            setNewFolderName(''); setIsNewFolderOpen(false);
            showToast('Folder Created');
        } catch (err) { showToast("Failed to create folder", "error"); }
    };

    const handleRename = async (e) => {
        e.preventDefault();
        if (!renameValue.trim() || selectedIds.size !== 1) return;
        const itemId = [...selectedIds][0];
        const item = files.find(f => f.id === itemId);
        if (!item) return;

        try {
            await executeBackendAction('rename', { itemId, type: item.type, newName: renameValue.trim(), currentVersion: parseInt(item.version) || 1 });
            await loadData();
            setIsRenameModalOpen(false);
            setSelectedIds(new Set());
            showToast('Renamed successfully');
        } catch (err) { showToast("Failed to rename", "error"); }
    };

    const executeSoftDelete = async () => {
        try {
            const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
            const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');
            
            await executeBackendAction('trash', { docIds, folderIds });
            await loadData();
            // Auto-reindex: remaining siblings shift up to fill gaps
            await executeRebuildIndex();
            setSelectedIds(new Set());
            setIsDeleteModalOpen(false);
            showToast('Moved to Trash');
        } catch (err) { showToast('Trash failed', 'error'); }
    };

    const executeRecover = async () => {
        try {
            const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
            const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');
            await executeBackendAction('recover', { docIds, folderIds });
            await loadData();
            // Auto-reindex: restored items get proper sequential indexes
            await executeRebuildIndex();
            setSelectedIds(new Set());
            showToast('Recovered files');
        } catch (err) { showToast('Recover failed', 'error'); }
    };

    const executePermanentDelete = async () => {
        try {
            const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
            const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');
            await executeBackendAction('permanent_delete', { docIds, folderIds });
            await loadData();
            // Auto-reindex: heal gaps left by permanently deleted items
            await executeRebuildIndex();
            setSelectedIds(new Set());
            setIsPermDeleteModalOpen(false);
            showToast('Deleted permanently');
        } catch (err) { showToast('Delete failed', 'error'); }
    };

    const calculateRemainingDays = (deletedAtStr, totalDays) => {
        if (!deletedAtStr || deletedAtStr === '--') return { daysLeft: totalDays, status: 'Safe', percentage: 100 };
        const delDate = new Date(deletedAtStr);
        if (isNaN(delDate.getTime())) return { daysLeft: totalDays, status: 'Safe', percentage: 100 };
        
        const now = new Date();
        const diffTime = now.getTime() - delDate.getTime();
        const elapsedDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
        const daysLeft = Math.max(0, totalDays - elapsedDays);
        const percentage = Math.max(0, Math.min(100, Math.round((daysLeft / totalDays) * 100)));
        
        let status = 'Safe';
        if (daysLeft === 0) status = 'Expired';
        else if (daysLeft <= 5) status = 'Expiring Soon';
        
        return { daysLeft, status, percentage };
    };

    const handleUpdateRetention = (newDays) => {
        setRetentionDays(newDays);
        localStorage.setItem('vdr_trash_retention_days', newDays.toString());
        showToast(`Trash retention policy updated to ${newDays} days`);
    };

    const handlePurgeExpired = async () => {
        const expiredItems = currentItems.filter(item => {
            const { daysLeft } = calculateRemainingDays(item.deletedAt, retentionDays);
            return daysLeft === 0;
        });

        if (expiredItems.length === 0) {
            showToast("No expired items found based on current retention policy.", "info");
            return;
        }

        const expiredDocs = expiredItems.filter(i => i.type !== 'folder').map(i => i.id);
        const expiredFolders = expiredItems.filter(i => i.type === 'folder').map(i => i.id);

        try {
            await executeBackendAction('permanent_delete', { docIds: expiredDocs, folderIds: expiredFolders });
            setFiles(prev => prev.filter(f => !expiredDocs.includes(f.id) && !expiredFolders.includes(f.id)));
            setDeletedIds(prev => {
                const next = new Set(prev);
                expiredDocs.forEach(id => next.delete(id));
                expiredFolders.forEach(id => next.delete(id));
                return next;
            });
            showToast(`Permanently purged ${expiredItems.length} expired item(s).`);
        } catch (err) {
            showToast("Failed to purge expired items: " + err.message, "error");
        }
    };

    const executeRecoverSingle = async (item) => {
        try {
            const docIds = item.type !== 'folder' ? [item.id] : [];
            const folderIds = item.type === 'folder' ? [item.id] : [];
            await executeBackendAction('recover', { docIds, folderIds });
            await loadData();
            await executeRebuildIndex();
            showToast(`Recovered "${item.name}"`);
        } catch (err) { showToast('Recover failed', 'error'); }
    };

    const executePermanentDeleteSingle = async (item) => {
        try {
            const docIds = item.type !== 'folder' ? [item.id] : [];
            const folderIds = item.type === 'folder' ? [item.id] : [];
            await executeBackendAction('permanent_delete', { docIds, folderIds });
            await loadData();
            await executeRebuildIndex();
            showToast(`Permanently deleted "${item.name}"`);
        } catch (err) { showToast('Permanent delete failed', 'error'); }
    };

    const executeMoveToFolder = async () => {
        try {
            const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
            const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');
            const targetFolderId = movingToFolderId === 'root' ? null : movingToFolderId;

            await executeBackendAction('move', { docIds, folderIds, targetFolderId });
            await loadData();
            // Auto-reindex: heals source folder gaps + assigns correct indexes in destination
            await executeRebuildIndex();
            setSelectedIds(new Set());
            setIsMoveModalOpen(false);
            showToast('Moved items');
        } catch (err) { showToast('Move failed', 'error'); }
    };

    // ── UPLOAD (Handled securely via FormData Backend API) ───────────────────
    const processFilesForUpload = async (chosenFiles) => {
        if (chosenFiles.length === 0 || !session) return;
        setUploadQueue(chosenFiles.map((f, i) => ({ id: `up-${Date.now()}-${i}`, name: f.name, progress: 0, status: 'uploading', size: formatBytes(f.size) })));
        setIsUploadModalOpen(true);

        let prefix = '';
        if (currentFolderId) {
            const parentFolder = files.find(f => f.id === currentFolderId);
            if (parentFolder) {
                const pDisplay = getActiveDisplayIndex(parentFolder);
                if (pDisplay && pDisplay !== '—' && pDisplay !== '99') prefix = `${pDisplay}.`;
            }
        }

        const peers = files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
        let nextIndex = peers.reduce((m, it) => {
            const lastPart = it.index ? it.index.toString().split('.').pop() : '0';
            return Math.max(m, parseInt(lastPart, 10) || 0);
        }, 0) + 1;

        for (let i = 0; i < chosenFiles.length; i++) {
            const file = chosenFiles[i];
            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('company_id', session.company_id);
                formData.append('workspace_id', session.active_workspace_id || '');
                formData.append('folder_id', currentFolderId || '');
                formData.append('uploaded_by', session.id);
                formData.append('index', `${prefix}${nextIndex + i}`);

                const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
                if (!res.ok) throw new Error('Server conversion failed');
                setUploadQueue(prev => prev.map((it, idx) => idx === i ? { ...it, progress: 100, status: 'completed' } : it));
                nextIndex++;
            } catch (err) {
                setUploadQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error' } : it));
            }
        }
        setTimeout(async () => {
            setUploadQueue([]); setIsUploadModalOpen(false);
            await loadData();
            // Auto-reindex: guarantees gap-free numbering even with multi-user uploads
            await executeRebuildIndex();
            showToast("Uploads Complete");
        }, 1500);
    };

    const handleFileChange = async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setInitialUploadFiles(Array.from(e.target.files));
            setIsUploadModalOpen(true);
            e.target.value = '';
        }
    };

    // ── DOWNLOADS (Hitting the new Download API) ─────────────────────────────
    const executeDownloadWrapper = async (actionType) => {
        setIsDownloadMenuOpen(false);
        for (let id of selectedIds) {
            const file = files.find(f => f.id === id);
            if (!file || file.type === 'folder') continue;

            setDownloading(prev => ({ ...prev, [file.id]: true }));
            try {
                const resolvedAction = actionType === 'secure' ? 'view' : actionType;
                const res = await fetch('/api/documents/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ docId: file.id, actionType: resolvedAction, session })
                });

                if (!res.ok) throw new Error("Download failed on server");
                
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url;
                
                if (actionType === 'original') {
                    a.download = file.name;
                } else {
                    const cleanName = file.name.split('.')[0];
                    const suffix = resolvedAction === 'edit' ? 'Editor' : 'SecureView';
                    a.download = `${cleanName}_${suffix}.html`;
                }

                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast("Download Complete");
                setDownloadedIds(prev => { const n = new Set(prev); n.add(file.id); return n; });
            } catch (err) { showToast(`Error: ${err.message}`, 'error'); } 
            finally { setDownloading(prev => { const n = { ...prev }; delete n[file.id]; return n; }); }
        }
    };

    // ── DRAG AND DROP HANDLERS ──
    const handleWindowDragOver = (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDraggingOverScreen(true);
            e.dataTransfer.dropEffect = 'copy';
        }
    };

    const handleWindowDragLeave = (e) => {
        e.preventDefault();
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setIsDraggingOverScreen(false);
    };

    const handleWindowDrop = (e) => {
        e.preventDefault();
        setIsDraggingOverScreen(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setInitialUploadFiles(Array.from(e.dataTransfer.files));
            setIsUploadModalOpen(true);
        }
    };

    const handleDragStart = (e, item, mode = 'move') => {
        if (currentView !== 'files') return;
        setDragMode(mode);
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e) => {
        if (currentView !== 'files') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDropToFolder = async (e, folderId) => {
        if (currentView !== 'files') return;
        e.preventDefault();
        const sourceId = e.dataTransfer.getData('text/plain');
        if (!sourceId) return;

        const sourceItem = files.find(f => f.id === sourceId);
        if (!sourceItem || sourceItem.parentId === folderId) return;

        const targetFolderId = folderId === 'root' ? null : folderId;

        try {
            await executeBackendAction('move', { 
                docIds: sourceItem.type !== 'folder' ? [sourceId] : [], 
                folderIds: sourceItem.type === 'folder' ? [sourceId] : [], 
                targetFolderId 
            });
            await loadData();
            // Auto-reindex: heals source folder gaps + assigns correct indexes in destination
            await executeRebuildIndex();
            showToast('Moved successfully ✓');
        } catch (err) { showToast('Failed to move', 'error'); }
    };

    const handleDrop = async (e, targetItem) => {
        if (currentView !== 'files') return;
        e.preventDefault();
        const sourceId = e.dataTransfer.getData('text/plain');
        if (!sourceId || sourceId === targetItem.id) return;

        const sourceItem = files.find(f => f.id === sourceId);
        if (!sourceItem) return;

        // If dropping ON a folder AND drag mode is not 'reorder' — move inside it
        if (targetItem.type === 'folder' && dragMode !== 'reorder') {
            handleDropToFolder(e, targetItem.id);
            return;
        }

        // Reorder among siblings
        const updatedFiles = files.map(f => ({ ...f }));
        const sourceIdxInUpdated = updatedFiles.findIndex(f => f.id === sourceId);

        let newParentId = targetItem.parentId;

        if (updatedFiles[sourceIdxInUpdated].parentId !== newParentId) {
            updatedFiles[sourceIdxInUpdated].parentId = newParentId;
            updatedFiles[sourceIdxInUpdated].index = '999999';
        }

        const siblings = updatedFiles.filter(f => f.parentId === newParentId && !deletedIds.has(f.id)).sort(sortItemsByIndex);
        const sourceIdx = siblings.findIndex(f => f.id === sourceId);
        const targetIdx = siblings.findIndex(f => f.id === targetItem.id);

        if (sourceIdx !== -1 && targetIdx !== -1) {
            // LITERALLY SWAP THEIR INDICES in the array for sorting
            const targetIdxInUpdated = updatedFiles.findIndex(f => f.id === targetItem.id);
            const tempIndex = updatedFiles[sourceIdxInUpdated].index;
            updatedFiles[sourceIdxInUpdated].index = updatedFiles[targetIdxInUpdated].index;
            updatedFiles[targetIdxInUpdated].index = tempIndex;
        }

        setFiles(updatedFiles);

        try {
            await executeRebuildIndex(updatedFiles, deletedIds, true);
            showToast('Order updated ✓');
        } catch (err) {
            showToast('Failed to update order: ' + err.message, 'error');
        }
    };

    // ── REBUILD INDEX (adapted for route.js backend) ───────────────────────────
    const executeRebuildIndex = async (overrideFiles = null, overrideDeletedIds = null, shouldReload = true) => {
        try {
            let currentFiles = Array.isArray(overrideFiles) ? overrideFiles : files;
            let currentDeletedIds = overrideDeletedIds instanceof Set ? overrideDeletedIds : deletedIds;

            if (!overrideFiles) {
                const fresh = await loadData();
                if (fresh) {
                    currentFiles = fresh.files;
                    currentDeletedIds = fresh.deletedIds;
                }
            }

            // Only active (non-deleted) items
            const activeItems = currentFiles.filter(f => !currentDeletedIds.has(f.id));

            // Group by parent
            const byParent = {};
            activeItems.forEach(f => {
                const pId = f.parentId || 'root';
                if (!byParent[pId]) byParent[pId] = [];
                byParent[pId].push(f);
            });

            // Sort each group: folders first, then by existing index
            Object.values(byParent).forEach(group => group.sort(sortItemsByIndex));

            const folderUpdates = [];
            const docUpdates = [];
            const localUpdates = new Map();

            // Recursively assign sequential hierarchical indexes
            const assignIndexes = (parentId, prefix) => {
                const group = byParent[parentId] || [];
                group.forEach((item, idx) => {
                    const newIndex = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
                    if (item.type === 'folder') {
                        folderUpdates.push({ id: item.id, index_number: idx + 1 });
                        localUpdates.set(item.id, (idx + 1).toString());
                        assignIndexes(item.id, newIndex);
                    } else {
                        docUpdates.push({ id: item.id, index: newIndex });
                        localUpdates.set(item.id, newIndex);
                    }
                });
            };
            assignIndexes('root', '');

            // Send bulk updates to backend via route.js
            await executeBackendAction('reindex', { folderUpdates, docUpdates });

            if (shouldReload) {
                await loadData();
            } else {
                setFiles(prev => prev.map(f => {
                    if (localUpdates.has(f.id)) return { ...f, index: localUpdates.get(f.id) };
                    return f;
                }));
            }
        } catch (err) {
            console.error('Rebuild Index failed:', err);
            showToast('Failed to rebuild index: ' + err.message, 'error');
        }
    };

    // UI RENDERING LOGIC
    const isGod = session?.role === 'super_admin';
    const selectionEnabled = !['bookmarks', 'downloads'].includes(currentView);
    const selectedItemsArray = files.filter(f => selectedIds.has(f.id));
    const canUploadHere = currentFolderId === null ? canUser('can_upload') : canUser('can_upload', { type: 'folder', id: currentFolderId });
    const canCreateFolder = isGod || globalFolderPerms.can_create;
    const canMergeFolder = isGod || globalFolderPerms.can_merge;
    const canDownloadSecureSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type !== 'folder' && canUser('can_download_secure', item));
    const canDownloadOriginalSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type !== 'folder' && canUser('can_download_original', item));
    const canDeleteSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type === 'folder' ? (isGod || globalFolderPerms.can_delete) : canUser('can_delete', item));
    const hasAnyRenameAccess = isGod || canUser('can_edit', { type: 'folder', id: currentFolderId }) || filteredItems.some(f => canUser('can_edit', f));
    const hasAnyDownloadAccess = isGod || canUser('can_download_secure', { type: 'folder', id: currentFolderId }) || canUser('can_download_original', { type: 'folder', id: currentFolderId }) || filteredItems.some(f => canUser('can_download_secure', f) || canUser('can_download_original', f));
    const hasAnyDeleteAccess = isGod || globalFolderPerms.can_delete || canUser('can_delete', { type: 'folder', id: currentFolderId }) || filteredItems.some(f => canUser('can_delete', f));
    const hasAnyExportAccess = isGod || canUser('can_export');

    if (loading && files.length === 0) return <div className="flex items-center justify-center w-full h-full bg-[#FAFBFD]"><div className="w-8 h-8 border-4 border-slate-200 border-t-brand rounded-full animate-spin" /></div>;

    return (
        <div 
            className="flex w-full h-full bg-[#F8F9FB] font-sans relative"
            onDragOver={handleWindowDragOver}
            onDragLeave={handleWindowDragLeave}
            onDrop={handleWindowDrop}
        >
            {isDraggingOverScreen && (
                <div className="absolute inset-0 z-[100] bg-brand-soft/80 border-4 border-dashed border-brand flex items-center justify-center pointer-events-none">
                    <div className="bg-white p-8 rounded-2xl shadow-xl flex flex-col items-center gap-4">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" className="animate-bounce">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <h2 className="text-2xl font-black text-slate-800">Drop files here to upload</h2>
                    </div>
                </div>
            )}

            {/* ── TOAST NOTIFICATION ── */}
            {toast && (
                <div style={{
                    position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '14px 20px', borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                    background: toast.type === 'error' ? '#FEF2F2' : '#F0FDF4',
                    border: `1.5px solid ${toast.type === 'error' ? '#FCA5A5' : '#86EFAC'}`,
                    color: toast.type === 'error' ? '#DC2626' : '#16A34A',
                    fontSize: '14px', fontWeight: '700',
                    animation: 'slideInRight 0.3s ease', maxWidth: '340px',
                }}>
                    {toast.type === 'error'
                        ? <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    }
                    {toast.message}
                </div>
            )}
            <style>{`@keyframes slideInRight { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>

            <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ── TOP ACTION BAR (Exact Firmata Match) ── */}
                <div className="flex items-center px-6 py-4 bg-white border-b border-slate-200">
                    <div className="flex items-center gap-3">
                        {!['trash', 'bookmarks', 'downloads'].includes(currentView) && canUploadHere && (
                            <button onClick={() => { setInitialUploadFiles([]); setIsUploadModalOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                                Upload
                            </button>
                        )}

                        {!['trash', 'bookmarks', 'downloads'].includes(currentView) && canCreateFolder && (
                            <button onClick={() => setIsNewFolderOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                                Add Folder
                            </button>
                        )}

                        {!['trash', 'bookmarks', 'downloads'].includes(currentView) && (
                            <div className="relative" onMouseLeave={() => setIsExportIndexMenuOpen(false)}>
                                <button
                                    onClick={() => setIsExportIndexMenuOpen(!isExportIndexMenuOpen)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors"
                                    title="Export complete Document Compliance Index hierarchy"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                                    Export Index
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`transition-transform ${isExportIndexMenuOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                                </button>
                                {isExportIndexMenuOpen && (
                                    <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50">
                                        <button
                                            onClick={() => {
                                                setIsExportIndexMenuOpen(false);
                                                exportIndexToExcel(files, deletedIds, session?.companyName || session?.workspaceName || session?.name || 'PIBI VDR • CONFIDENTIAL DATA ROOM');
                                                showToast("Document Index Exported as Excel (.xlsx)");
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-[12px] font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2.5 transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-emerald-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>
                                            Excel (.xlsx)
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setIsExportIndexMenuOpen(false);
                                                try {
                                                    await exportIndexToPDF(files, deletedIds, session?.companyName || session?.workspaceName || session?.name || 'PIBI VDR • CONFIDENTIAL DATA ROOM');
                                                    showToast("Document Index Exported as PDF");
                                                } catch (err) {
                                                    showToast("PDF export error: " + err.message, "error");
                                                }
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-[12px] font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-700 flex items-center gap-2.5 transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-rose-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12v5"/><path d="M14 12v5"/></svg>
                                            PDF
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {!['trash', 'bookmarks', 'downloads'].includes(currentView) && (
                            <button onClick={async () => {
                                await executeRebuildIndex(null, null, false);
                                showToast("Index successfully rebuilt");
                            }} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors" title="Force Rebuild Index">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                                Rebuild Index
                            </button>
                        )}

                        {!['trash', 'bookmarks', 'downloads'].includes(currentView) && hasAnyRenameAccess && (
                            <button disabled={selectedIds.size !== 1} onClick={() => {
                                const item = files.find(f => f.id === [...selectedIds][0]);
                                if (item) { setRenameValue(item.name); setIsRenameModalOpen(true); }
                            }} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size !== 1 ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-slate-600 hover:bg-brand-soft hover:text-brand'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                                Rename
                            </button>
                        )}

                        {!['trash', 'bookmarks', 'downloads'].includes(currentView) && hasAnyDownloadAccess && (
                            <div className="relative">
                                <button disabled={selectedIds.size === 0} onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-slate-600 hover:bg-brand-soft hover:text-brand'}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    Download
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`transition-transform ${isDownloadMenuOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                                </button>
                                {isDownloadMenuOpen && selectedIds.size > 0 && (
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50">
                                        {canDownloadSecureSelected && <button onClick={() => executeDownloadWrapper('secure')} className="w-full text-left px-4 py-2 text-[12px] font-bold text-slate-700 hover:bg-brand-soft">Download Secure (.html)</button>}
                                        {canDownloadOriginalSelected && <button onClick={() => executeDownloadWrapper('original')} className="w-full text-left px-4 py-2 text-[12px] font-bold text-slate-700 hover:bg-brand-soft">Download Original</button>}
                                        {!canDownloadSecureSelected && !canDownloadOriginalSelected && <div className="px-4 py-2 text-[12px] font-medium text-slate-400">No permission</div>}
                                    </div>
                                )}
                            </div>
                        )}

                        {currentView !== 'trash' && hasAnyDeleteAccess && (
                            <button disabled={selectedIds.size === 0 || !canDeleteSelected} onClick={() => setIsDeleteModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 || !canDeleteSelected ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-rose-600 hover:bg-rose-50'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
                                Delete
                            </button>
                        )}
                        {currentView !== 'trash' && canMergeFolder && (
                            <button disabled={selectedIds.size === 0 || !canMergeFolder} onClick={() => setIsMoveModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 || !canMergeFolder ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-[var(--brand)] hover:bg-[var(--brand-soft)]'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
                                Move Items
                            </button>
                        )}
                        {currentView === 'trash' && (
                            <>
                                <button disabled={selectedIds.size === 0} onClick={executeRecover} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-emerald-600 hover:bg-emerald-50'}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                                    Recover
                                </button>
                                <button disabled={selectedIds.size === 0} onClick={() => setIsPermDeleteModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-rose-600 hover:bg-rose-50'}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
                                    Permanent Delete
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* ── BREADCRUMBS & LIST ── */}
                <div className="flex-1 flex flex-col p-6 overflow-hidden">
                    <div className="flex items-center gap-2 mb-4 px-2">
                        <button 
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDropToFolder(e, null)}
                            onClick={() => setCurrentFolderId(null)} 
                            className={`text-[14px] font-black ${currentFolderId === null ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>home</button>
                        {breadcrumbPath.map(crumb => (
                            <React.Fragment key={crumb.id}>
                                <span className="text-slate-300 font-black">&gt;</span>
                                <button 
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDropToFolder(e, crumb.id)}
                                    onClick={() => setCurrentFolderId(crumb.id)} 
                                    className={`text-[14px] font-black ${currentFolderId === crumb.id ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>{crumb.name}</button>
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-white border-b border-slate-100">
                                <tr>
                                    {selectionEnabled ? (
                                        <th className="py-4 px-5 w-10">
                                            <input type="checkbox" checked={selectedIds.size === filteredItems.length && filteredItems.length > 0} onChange={handleSelectAll} className="w-4 h-4 rounded border-slate-300 accent-slate-900" />
                                        </th>
                                    ) : null}
                                    <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center w-16">Index</th>
                                    <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Name</th>
                                    {currentView !== 'trash' && <th className="py-4 px-3 w-8 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Star</th>}
                                    {currentView !== 'trash' && <th className="py-4 px-3 w-16 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Q&amp;A</th>}
                                    <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Version</th>
                                    {currentView === 'trash' ? (
                                        <>
                                            <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Original Location</th>
                                            <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Deleted By</th>
                                            <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Deleted At</th>
                                            <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Days Left</th>
                                        </>
                                    ) : (
                                        <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Created At</th>
                                    )}
                                    <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Size</th>
                                    {currentView !== 'trash' && <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Permission Details</th>}
                                    {currentView === 'trash' && <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredItems.map(item => {
                                    const isChecked = selectedIds.has(item.id);
                                    const isFolder = item.type === 'folder';
                                    const isDL = downloading[item.id];

                                    return (
                                        <tr
                                            key={item.id}
                                            className={`group transition-colors ${selectionEnabled ? 'cursor-pointer' : ''} ${isChecked ? 'bg-brand-soft' : 'hover:bg-brand-soft/50'}`}
                                            onClick={selectionEnabled ? (e) => { e.stopPropagation(); setSelectedIds(prev => { const next = new Set(prev); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; }); } : undefined}
                                            draggable={currentView === 'files'}
                                            onDragStart={(e) => handleDragStart(e, item)}
                                            onDragOver={handleDragOver}
                                            onDrop={(e) => handleDrop(e, item)}
                                        >
                                            {selectionEnabled ? (
                                                <td className="py-4 px-5" onClick={e => e.stopPropagation()}>
                                                    <input type="checkbox" checked={isChecked} onChange={e => { e.stopPropagation(); setSelectedIds(prev => { const next = new Set(prev); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; }); }} className="w-4 h-4 rounded border-slate-300 accent-slate-900" />
                                                </td>
                                            ) : null}
                                            <td className="py-4 px-3 text-center text-[12px] font-mono font-semibold text-slate-500">
                                                {item.displayIndex || '—'}
                                            </td>
                                            
                                            {/* 🔥 THE NAME COLUMN - Fully Restored */}
                                            <td className="py-4 px-3" onClick={isFolder ? (e) => { e.stopPropagation(); setCurrentFolderId(item.id); } : undefined}>
                                                <div className="flex items-center gap-3">
                                                    {currentView === 'files' && (
                                                        <div 
                                                            draggable
                                                            onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, item, 'reorder'); }}
                                                            className="cursor-grab active:cursor-grabbing hover:bg-slate-200 p-1 rounded text-slate-400 hover:text-slate-600 transition-colors mr-1 flex items-center justify-center"
                                                            title="Drag here to reorder"
                                                        >
                                                            <FaGripVertical size={14} />
                                                        </div>
                                                    )}
                                                    {isFolder ? (
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#fcd34d"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
                                                    ) : (
                                                        <div className="w-5 h-5 bg-slate-100 rounded text-[8px] font-black text-slate-500 flex items-center justify-center">{item.type.toUpperCase().slice(0, 3)}</div>
                                                    )}

                                                    <span
                                                        className={`text-[13px] font-semibold transition-colors ${!isFolder && canUser('can_view', item) ? 'text-slate-800 hover:text-[var(--brand)] hover:underline cursor-pointer' : isFolder ? 'text-slate-800 hover:text-[var(--brand)] hover:underline cursor-pointer' : 'text-slate-800'}`}
                                                        onClick={(e) => {
                                                             e.stopPropagation(); 
                                                            if (isFolder) {
                                                                setCurrentFolderId(item.id);
                                                            } else {
                                                                if (canUser('can_view', item)) window.open(`/view/${item.id}`, '_blank');
                                                                else alert("You do not have permission to view this file.");
                                                            }
                                                        }}
                                                    >
                                                        {item.name}
                                                    </span>

                                                    {isDL && <span className="ml-2 text-[10px] text-emerald-600 font-bold animate-pulse">Downloading...</span>}
                                                </div>
                                            </td>

                                            {currentView !== 'trash' && (
                                                <td className="py-4 px-2 text-center" onClick={e => handleToggleBookmark(item, e)}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={bookmarkedIds.has(item.id) ? "#fbbf24" : "none"} stroke={bookmarkedIds.has(item.id) ? "#fbbf24" : "#cbd5e1"} strokeWidth="2.5" className="cursor-pointer transition-colors hover:stroke-amber-400 mx-auto">
                                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                    </svg>
                                                </td>
                                            )}
                                            {currentView !== 'trash' && (
                                                <td className="py-4 px-3 text-center" onClick={(e) => { e.stopPropagation(); router.push(isFolder ? `/qa?folderId=${item.id}` : `/qa?fileId=${item.id}`); }}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto cursor-pointer hover:stroke-[var(--brand)] transition-colors">
                                                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                                                    </svg>
                                                </td>
                                            )}
                                            <td className="py-4 px-3 text-[12px] font-medium text-slate-500 text-center">V{item.version || 1}</td>
                                            {currentView === 'trash' ? (
                                                <>
                                                    <td className="py-4 px-3 text-[12px] font-medium text-slate-500">
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-mono text-[11px] max-w-[220px] truncate" title={item.locationPath || '/'}>
                                                            {item.locationPath || '/'}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.deletedBy}</td>
                                                    <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.deletedAt}</td>
                                                    <td className="py-4 px-3 text-center">
                                                        {(() => {
                                                            const { daysLeft } = calculateRemainingDays(item.deletedAt, retentionDays || 30);
                                                            return (
                                                                <span className={`text-[11.5px] font-bold px-2.5 py-0.5 rounded-full ${daysLeft <= 5 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                                                    {daysLeft} days
                                                                </span>
                                                            );
                                                        })()}
                                                    </td>
                                                </>
                                            ) : (
                                                <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.dateCreated}</td>
                                            )}
                                            <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.size}</td>
                                            
                                            {/* 🔥 THE ACTIONS COLUMN - Fully Restored */}
                                            {/* {currentView !== 'trash' && (
                                                <td className="py-4 px-3">
                                                    <div className="flex items-center gap-5 text-[15px]">
                                                        {canUser('can_view', item) ? (
                                                            <FaEye className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="View" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('view'), 50); }} />
                                                        ) : (
                                                            <FaEye className="text-slate-200" title="No View Access" />
                                                        )}

                                                        {canUser('can_edit', item) && ['xlsx', 'xls', 'csv', 'docx', 'doc', 'txt'].includes(item.type) ? (
                                                            <FaEdit className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Edit Document" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('edit'), 50); }} />
                                                        ) : (
                                                            <FaEdit className="text-slate-200" title={['pdf'].includes(item.type) ? "PDFs cannot be edited" : "No Edit Access"} />
                                                        )}

                                                        {isFolder ? (
                                                            canUser('can_upload', item) ? <FaUpload className="text-slate-600 cursor-pointer hover:text-brand" title="Upload" onClick={(e) => { e.stopPropagation(); setCurrentFolderId(item.id); fileInputRef.current?.click(); }} /> : <FaUpload className="text-slate-200" title="No Upload Access" />
                                                        ) : <div className="w-[15px]"></div>}

                                                        {canUser('can_download_secure', item) && !isFolder ? (
                                                            <FaShieldAlt className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Download Secure" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('secure'), 50); }} />
                                                        ) : !isFolder ? (
                                                            <FaShieldAlt className="text-slate-200" title="No Secure DL Access" />
                                                        ) : null}

                                                        {canUser('can_download_original', item) && !isFolder ? (
                                                            <FaDownload className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Download Original" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('original'), 50); }} />
                                                        ) : !isFolder ? (
                                                            <FaDownload className="text-slate-200" title="No Original DL Access" />
                                                        ) : null}

                                                        {canUser('can_delete', item) ? (
                                                            <FaTrash className="text-slate-600 cursor-pointer hover:text-red-500 transition-colors text-[14px]" title="Delete" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setIsDeleteModalOpen(true); }} />
                                                        ) : (
                                                            <FaTrash className="text-slate-200 text-[14px]" title="No Delete Access" />
                                                        )}
                                                    </div>
                                                </td>
                                            )} */}

                                            {/* 🔥 THE ACTIONS COLUMN - Perfectly Aligned & Restored */}
                                            {currentView !== 'trash' && (
                                                <td className="py-4 px-3">
                                                    <div className="flex items-center gap-5 text-[15.5px]">
                                                        {/* VIEW */}
                                                        {canUser('can_view', item) ? (
                                                            <FaEye className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="View" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('view'), 50); }} />
                                                        ) : (
                                                            <FaEye className="text-slate-200" title="No View Access" />
                                                        )}

                                                        {/* EDIT */}
                                                        {canUser('can_edit', item) && ['xlsx', 'xls', 'csv', 'docx', 'doc', 'txt'].includes(item.type) ? (
                                                            <FaEdit className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Edit Document" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('edit'), 50); }} />
                                                        ) : (
                                                            <FaEdit className="text-slate-200" title={['pdf'].includes(item.type) ? "PDFs cannot be edited" : "No Edit Access"} />
                                                        )}

                                                        {/* UPLOAD (Fades out for files to keep spacing perfect) */}
                                                        {item.type === 'folder' ? (
                                                            canUser('can_upload', item) ? (
                                                                <FaUpload className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Upload to Folder" onClick={(e) => { e.stopPropagation(); setCurrentFolderId(item.id); fileInputRef.current?.click(); }} />
                                                            ) : (
                                                                <FaUpload className="text-slate-200" title="No Upload Access" />
                                                            )
                                                        ) : (
                                                            <FaUpload className="text-slate-100 cursor-not-allowed" title="Upload is for folders only" onClick={(e) => e.stopPropagation()} />
                                                        )}

                                                        {/* SECURE DOWNLOAD (.html) */}
                                                        {canUser('can_download_secure', item) && item.type !== 'folder' ? (
                                                            <FaShieldAlt className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Download Secure" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('secure'), 50); }} />
                                                        ) : item.type !== 'folder' ? (
                                                            <FaShieldAlt className="text-slate-200" title="No Secure DL Access" />
                                                        ) : null}

                                                        {/* ORIGINAL DOWNLOAD */}
                                                        {canUser('can_download_original', item) && item.type !== 'folder' ? (
                                                            <FaDownload className="text-slate-600 cursor-pointer hover:text-brand transition-colors" title="Download Original" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setTimeout(() => executeDownloadWrapper('original'), 50); }} />
                                                        ) : item.type !== 'folder' ? (
                                                            <FaDownload className="text-slate-200" title="No Original DL Access" />
                                                        ) : null}

                                                        {/* DELETE */}
                                                        {canUser('can_delete', item) ? (
                                                            <FaTrash className="text-slate-600 cursor-pointer hover:text-red-500 transition-colors text-[14px]" title="Delete" onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([item.id])); setIsDeleteModalOpen(true); }} />
                                                        ) : (
                                                            <FaTrash className="text-slate-200 text-[14px]" title="No Delete Access" />
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                            {currentView === 'trash' && (
                                                <td className="py-4 px-3 text-center">
                                                    <div className="flex items-center justify-center gap-5">
                                                        <svg
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2.2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            className="w-4 h-4 text-slate-600 cursor-pointer hover:text-[var(--brand)] transition-colors"
                                                            title="Restore from Trash"
                                                            onClick={(e) => { e.stopPropagation(); executeRecoverSingle(item); }}
                                                        >
                                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                                            <path d="M3 3v5h5" />
                                                        </svg>
                                                        {isGod && (
                                                            <FaTrash
                                                                className="text-slate-600 cursor-pointer hover:text-red-500 transition-colors text-[14px]"
                                                                title="Permanently Purge"
                                                                onClick={(e) => { e.stopPropagation(); executePermanentDeleteSingle(item); }}
                                                            />
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* MODALS */}
            {isMoveModalOpen && (
                <Modal onClose={() => setIsMoveModalOpen(false)}>
                    <h3 className="text-[15px] font-black mb-4">Move {selectedIds.size} items to...</h3>
                    <div className="space-y-1 max-h-64 overflow-y-auto mb-4">
                        <button onClick={() => setMovingToFolderId(null)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[12.5px] font-semibold ${movingToFolderId === null ? 'bg-[var(--brand)] text-white' : 'hover:bg-brand-soft text-slate-700'}`}>
                            Root Directory
                        </button>
                        {files.filter(f => f.type === 'folder' && !deletedIds.has(f.id) && !selectedIds.has(f.id)).map(folder => (
                            <button key={folder.id} onClick={() => setMovingToFolderId(folder.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[12.5px] font-semibold ${movingToFolderId === folder.id ? 'bg-[var(--brand)] text-white' : 'hover:bg-brand-soft text-slate-700'}`}>
                                <span className="truncate">{folder.name}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setIsMoveModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 font-bold rounded-xl text-[13px]">Cancel</button>
                        <button onClick={executeMoveToFolder} className="flex-1 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-bold rounded-xl text-[13px]">Move Here</button>
                    </div>
                </Modal>
            )}

            {isPermDeleteModalOpen && (
                <Modal onClose={() => setIsPermDeleteModalOpen(false)}>
                    <h3 className="text-[16px] font-black text-slate-900 mb-2">Permanently Delete?</h3>
                    <p className="text-[13px] text-slate-500 mb-6">Are you sure you want to permanently delete these items? This action cannot be undone.</p>
                    <div className="flex gap-2">
                        <button onClick={() => setIsPermDeleteModalOpen(false)} className="flex-1 py-3 bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold rounded-xl text-[14px]">Cancel</button>
                        <button onClick={executePermanentDelete} className="flex-1 py-3 bg-rose-500 text-white hover:bg-rose-600 font-bold rounded-xl text-[14px]">Delete</button>
                    </div>
                </Modal>
            )}

            {isDeleteModalOpen && (
                <Modal onClose={() => setIsDeleteModalOpen(false)}>
                    <h3 className="text-[16px] font-black text-slate-900 mb-2">Send to Trash?</h3>
                    <p className="text-[13px] text-slate-500 mb-6">These files will be moved to the Trash bin.</p>
                    <div className="flex gap-2">
                        <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-3 bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold rounded-xl text-[14px]">Cancel</button>
                        <button onClick={executeSoftDelete} className="flex-1 py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-bold rounded-xl text-[14px]">Send to Trash</button>
                    </div>
                </Modal>
            )}

            {isNewFolderOpen && (
                <Modal onClose={() => setIsNewFolderOpen(false)}>
                    <h3 className="text-[16px] font-black mb-4">Create New Folder</h3>
                    <input type="text" placeholder="Folder name..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl mb-4 focus:border-[var(--brand)] focus:outline-none" />
                    <button onClick={handleCreateFolder} className="w-full py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-bold rounded-xl">Create</button>
                </Modal>
            )}

            {isRenameModalOpen && (
                <Modal onClose={() => setIsRenameModalOpen(false)}>
                    <h3 className="text-[16px] font-black text-slate-900 mb-4">Rename Item</h3>
                    <form onSubmit={handleRename}>
                        <input type="text" placeholder="New name..." value={renameValue} onChange={e => setRenameValue(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl mb-4 focus:border-[var(--brand)] focus:outline-none" autoFocus />
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setIsRenameModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 hover:bg-slate-300 font-bold rounded-xl text-[14px]">Cancel</button>
                            <button type="submit" className="flex-1 py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-bold rounded-xl text-[14px]">Rename</button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Bulk Upload Progress Tracking Modal */}
            <BulkUploadModal
                isOpen={isUploadModalOpen}
                onClose={() => {
                    setIsUploadModalOpen(false);
                    setInitialUploadFiles([]);
                }}
                session={session}
                currentFolderId={currentFolderId}
                files={files}
                deletedIds={deletedIds}
                getActiveDisplayIndex={getActiveDisplayIndex}
                onUploadSuccess={async () => {
                    await loadData();
                    await executeRebuildIndex();
                }}
                showToast={showToast}
                initialFiles={initialUploadFiles}
            />
        </div>
    );
}

function Modal({ children, onClose, maxWidth = 'max-w-lg' }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div onClick={onClose} className="absolute inset-0 bg-brand/40 backdrop-blur-[3px]" />
            <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${maxWidth} p-6 z-10`}>
                {children}
            </div>
        </div>
    );
}

















// perfectly working code fully backend and frontend  

// "use client";

// import React, { useState, useMemo, useRef, useEffect, Suspense, useCallback } from 'react';
// import { useSearchParams, useRouter } from 'next/navigation';
// import { supabase } from '@/utils/supabase/client';
// import fernet from 'fernet';
// import { FaEye, FaEdit, FaUpload, FaShieldAlt, FaDownload, FaTrash } from 'react-icons/fa';
// import { generateSecureHtmlWrapper } from '@/utils/vdrEngine';

// export default function DocumentsPage() {
//     return (
//         <Suspense fallback={<div className="flex items-center justify-center w-full h-full bg-[#FAFBFD]"><div className="w-8 h-8 border-4 border-slate-200 border-t-brand rounded-full animate-spin" /></div>}>
//             <UnifiedWorkspace />
//         </Suspense>
//     );
// }

// function UnifiedWorkspace() {
//     const router = useRouter();
//     const searchParams = useSearchParams();
//     const currentView = searchParams.get('view') || 'files';
//     const [session, setSession] = useState(null);

//     // Core Data
//     const [files, setFiles] = useState([]);
//     const [mergedPerms, setMergedPerms] = useState({});
//     const [globalFolderPerms, setGlobalFolderPerms] = useState({ can_create: false, can_merge: false, can_delete: false });

//     // UI State
//     const [loading, setLoading] = useState(true);
//     const [currentFolderId, setCurrentFolderId] = useState(null);
//     const [searchQuery, setSearchQuery] = useState('');
//     const [selectedIds, setSelectedIds] = useState(new Set());
//     const [deletedIds, setDeletedIds] = useState(new Set());
//     const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
//     const [downloadedIds, setDownloadedIds] = useState(new Set());
//     const [downloading, setDownloading] = useState({});

//     // Rebuild Index State
//     const [isRebuilding, setIsRebuilding] = useState(false);
//     const [isRebuildIndexModalOpen, setIsRebuildIndexModalOpen] = useState(false);

//     const formatBytes = (bytes) => {
//         if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '--';
//         if (bytes < 1024) return `${bytes} B`;
//         if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
//         if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
//         return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
//     };

//     const sortItemsByIndex = (a, b) => {
//         if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
//         const compareIndexes = (idxA, idxB) => {
//             const partsA = (idxA || '999999').toString().split('.').map(n => parseInt(n, 10) || 0);
//             const partsB = (idxB || '999999').toString().split('.').map(n => parseInt(n, 10) || 0);
//             const len = Math.max(partsA.length, partsB.length);
//             for (let i = 0; i < len; i++) {
//                 const numA = partsA[i] || 0;
//                 const numB = partsB[i] || 0;
//                 if (numA !== numB) return numA - numB;
//             }
//             return 0;
//         };
//         const idxCmp = compareIndexes(a.index, b.index);
//         if (idxCmp !== 0) return idxCmp;
//         return a.name.localeCompare(b.name);
//     };

//     // Dropdowns & Modals
//     const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
//     const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
//     const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
//     const [newFolderName, setNewFolderName] = useState('');
//     const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
//     const [renameValue, setRenameValue] = useState('');
//     const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
//     const [isPermDeleteModalOpen, setIsPermDeleteModalOpen] = useState(false);
//     const [uploadQueue, setUploadQueue] = useState([]);
//     const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' }

//     const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
//     const [movingToFolderId, setMovingToFolderId] = useState(null);

//     const fileInputRef = useRef(null);
//     const folderInputRef = useRef(null);

//     // Save selected item for QA page redirect
//     useEffect(() => {
//         if (selectedIds.size === 1) {
//             const id = [...selectedIds][0];
//             const item = files.find(f => f.id === id);
//             if (item) {
//                 localStorage.setItem('vdr_selected_qa_item', JSON.stringify({ id: item.id, type: item.type }));
//             }
//         } else {
//             localStorage.removeItem('vdr_selected_qa_item');
//         }
//     }, [selectedIds, files]);

//     // ── SESSION ──────────────────────────────────────────────────────────────
//     useEffect(() => {
//         const raw = localStorage.getItem('vdr_session');
//         if (!raw) { router.push('/login'); return; }
//         setSession(JSON.parse(raw));
//     }, [router]);

//     // ── SMART FETCH (ABAC ENGINE) ────────────────────────────────────────────
//     useEffect(() => {
//         if (!session) return;
//         (async () => {
//             setLoading(true);
//             try {
//                 const isGodMode = session.role === 'super_admin';

//                 // 🔥 Declare BOTH variables up here so the whole function can access them!
//                 let myPerms = {};
//                 let globalTemp = { can_create: false, can_merge: false, can_delete: false };

//                 if (!isGodMode) {
//                     const { data: myGroups } = await supabase.from('user_groups').select('group_id').eq('user_id', session.id);
//                     const groupIds = (myGroups || []).map(g => g.group_id);

//                     if (groupIds.length > 0) {
//                         const { data: perms } = await supabase.from('permissions').select('*').in('group_id', groupIds);

//                         (perms || []).forEach(p => {
//                             // Catch the new global 'files' scope
//                             if (p.scope === 'files') {
//                                 globalTemp.can_create = globalTemp.can_create || p.can_create_folder;
//                                 globalTemp.can_merge = globalTemp.can_merge || p.can_merge_folder;
//                                 globalTemp.can_delete = globalTemp.can_delete || p.can_delete_folder;
//                             }

//                             const key = p.scope === 'folder' ? `fol_${p.folder_id}` : `doc_${p.document_id}`;


//                             if (!myPerms[key]) {
//                                 myPerms[key] = { ...p };
//                             } else {
//                                 myPerms[key].can_view = myPerms[key].can_view || p.can_view;
//                                 myPerms[key].can_edit = myPerms[key].can_edit || p.can_edit;
//                                 myPerms[key].can_upload = myPerms[key].can_upload || p.can_upload;
//                                 myPerms[key].can_download_secure = myPerms[key].can_download_secure || p.can_download_secure;
//                                 myPerms[key].can_download_original = myPerms[key].can_download_original || p.can_download_original;
//                                 myPerms[key].can_delete = myPerms[key].can_delete || p.can_delete;
//                             }
//                         });
//                     }
//                 }

//                 const [{ data: foldersData }, { data: docsData }, { data: usersData }] = await Promise.all([
//                     supabase.from('folders').select('*').eq('company_id', session.company_id),
//                     supabase.from('documents').select('*').eq('company_id', session.company_id),
//                     supabase.from('users').select('id, name').eq('company_id', session.company_id),
//                 ]);

//                 const userMap = {};
//                 (usersData || []).forEach(u => userMap[u.id] = u.name);

//                 const calculateFolderSize = (folderId) => {
//                     let total = 0;

//                     const addFolderSize = (id) => {
//                         // Files inside this folder
//                         (docsData || []).forEach(doc => {
//                             if (doc.folder_id === id) {
//                                 total += Number(doc.file_size_bytes) || 0;
//                             }
//                         });

//                         // Child folders
//                         (foldersData || []).forEach(folder => {
//                             if (folder.parent_folder_id === id) {
//                                 addFolderSize(folder.id);
//                             }
//                         });
//                     };

//                     addFolderSize(folderId);

//                     return formatBytes(total);
//                 };

//                 // Folders Map
//                 const mappedFolders = (foldersData || [])
//                     // 🔥 STRIPPED Admin/Subadmin bypass. Added creator_revoked check!
//                     .filter(f =>
//                         isGodMode ||
//                         (f.created_by === session.id && f.creator_revoked !== true) ||
//                         myPerms[`fol_${f.id}`]?.can_view
//                     )
//                     .map(f => ({
//                         id: f.id, parentId: f.parent_folder_id || null, index: f.index_number ? f.index_number.toString() : '1',
//                         name: f.name, type: 'folder', size: calculateFolderSize(f.id), uploadedBy: userMap[f.created_by] || 'System',
//                         dateCreated: new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
//                         deletedBy: userMap[f.deleted_by] || 'Unknown',
//                         deletedAt: f.deleted_at ? new Date(f.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--',
//                         is_bookmarked: f.is_bookmarked, is_deleted: f.is_deleted,
//                         creator_id: f.created_by, // 🔥 Tracks the creator
//                         creator_revoked: f.creator_revoked, // 🔥 Tracks the Kill Switch
//                         version: parseInt(f.version) || 1
//                     }));

//                 // Docs Map
//                 const mappedDocs = (docsData || [])
//                     // 🔥 STRIPPED Admin/Subadmin bypass. Added creator_revoked check!
//                     .filter(doc =>
//                         isGodMode ||
//                         (doc.uploaded_by === session.id && doc.creator_revoked !== true) ||
//                         myPerms[`doc_${doc.id}`]?.can_view ||
//                         (doc.folder_id && myPerms[`fol_${doc.folder_id}`]?.can_view)
//                     )
//                     .map(doc => ({
//                         id: doc.id, parentId: doc.folder_id || null, index: doc.index ? doc.index.toString().replace('.0', '') : '99',
//                         name: doc.name,
//                         type: doc.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/gi, '') || 'file',
//                         size: formatBytes(doc.file_size_bytes),
//                         uploadedBy: userMap[doc.uploaded_by] || 'System',
//                         dateCreated: new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
//                         deletedBy: userMap[doc.deleted_by] || 'Unknown',
//                         deletedAt: doc.deleted_at ? new Date(doc.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--',
//                         is_bookmarked: doc.is_bookmarked, is_downloaded: doc.is_downloaded, is_deleted: doc.is_deleted,
//                         file_path: doc.file_path,
//                         original_file_path: doc.original_file_path,
//                         dek_ref: doc.dek_ref, mime_type: doc.mime_type,
//                         creator_id: doc.uploaded_by, // 🔥 Tracks the creator
//                         creator_revoked: doc.creator_revoked, // 🔥 Tracks the Kill Switch
//                         version: parseInt(doc.version) || 1
//                     }));

//                 // Add creator_id: f.created_by to mappedFolders
//                 // const mappedFolders = (foldersData || [])
//                 //     .filter(f => isGodMode || f.created_by === session.id || myPerms[`fol_${f.id}`]?.can_view || session.role === 'admin' || session.role === 'subadmin')
//                 //     .map(f => ({
//                 //         id: f.id,
//                 //         parentId: f.parent_folder_id || null,
//                 //         creator_id: f.created_by,
//                 //         //id: f.id, parentId: f.parent_folder_id || null,
//                 //         index: f.index_number ? f.index_number.toString() : '1',
//                 //         name: f.name, type: 'folder', size: calculateFolderSize(f.id), uploadedBy: userMap[f.created_by] || 'System',
//                 //         dateCreated: new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
//                 //         deletedBy: userMap[f.deleted_by] || 'Unknown',
//                 //         deletedAt: f.deleted_at ? new Date(f.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--',
//                 //         is_bookmarked: f.is_bookmarked, is_deleted: f.is_deleted
//                 //     }));


//                 // // Docs Map
//                 // const mappedDocs = (docsData || [])
//                 //     // 🔥 THE FIX: Added Admin/Subadmin bypass and Folder Inheritance!
//                 //     .filter(doc =>
//                 //         isGodMode ||
//                 //         session.role === 'admin' ||
//                 //         session.role === 'subadmin' ||
//                 //         doc.uploaded_by === session.id ||
//                 //         myPerms[`doc_${doc.id}`]?.can_view ||
//                 //         (doc.folder_id && myPerms[`fol_${doc.folder_id}`]?.can_view)
//                 //     )
//                 //     .map(doc => ({
//                 //         id: doc.id, parentId: doc.folder_id || null, creator_id: doc.uploaded_by, index: doc.index ? doc.index.toString().replace('.0', '') : '99',
//                 //         name: doc.name,
//                 //         // THIS IS THE MAGIC LINE: Strips all dots and spaces!
//                 //         type: doc.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/gi, '') || 'file',
//                 //         size: formatBytes(doc.file_size_bytes),
//                 //         uploadedBy: userMap[doc.uploaded_by] || 'System',
//                 //         dateCreated: new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
//                 //         deletedBy: userMap[doc.deleted_by] || 'Unknown',
//                 //         deletedAt: doc.deleted_at ? new Date(doc.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--',
//                 //         is_bookmarked: doc.is_bookmarked, is_downloaded: doc.is_downloaded, is_deleted: doc.is_deleted,
//                 //         file_path: doc.file_path,
//                 //         original_file_path: doc.original_file_path,
//                 //         dek_ref: doc.dek_ref, mime_type: doc.mime_type
//                 //     }));



//                 setMergedPerms(myPerms);
//                 setGlobalFolderPerms(globalTemp);
//                 setFiles([...mappedFolders, ...mappedDocs]);
//                 setBookmarkedIds(new Set([...(docsData || []).filter(d => d.is_bookmarked).map(d => d.id), ...(foldersData || []).filter(f => f.is_bookmarked).map(f => f.id)]));
//                 setDownloadedIds(new Set((docsData || []).filter(d => d.is_downloaded).map(d => d.id)));
//                 setDeletedIds(new Set([
//                     ...(docsData || []).filter(d => d.is_deleted).map(d => d.id),
//                     ...(foldersData || []).filter(f => f.is_deleted).map(f => f.id)
//                 ]));
//             } catch (err) { console.error('Fetch error:', err); }
//             finally { setLoading(false); }
//         })();
//     }, [session]);

//     // ── PERMISSION HELPER ────────────────────────────────────────────────────
//     // const canUser = (action, item = null) => {
//     //     if (!session) return false;
//     //     if (session.role === 'super_admin') return true;

//     //     if (!item) {
//     //         if (action === 'can_upload' && currentFolderId === null) return session.role === 'super_admin';
//     //         if (action === 'can_export') return session.role === 'super_admin';
//     //         return false;
//     //     }

//     //     const key = item.type === 'folder' ? `fol_${item.id}` : `doc_${item.id}`;
//     //     return mergedPerms[key]?.[action] === true;
//     // };



//     // ── PERMISSION HELPER ────────────────────────────────────────────────────
//     const canUser = (action, item = null) => {
//         if (!session) return false;

//         // ONLY Super Admin has unblockable God Mode
//         if (session.role === 'super_admin') return true;

//         if (!item) {
//             if (action === 'can_upload' && currentFolderId === null) return false;
//             if (action === 'can_export') return false;
//             return false;
//         }

//         // 🔥 The Creator gets full button access ONLY IF Super Admin hasn't revoked them
//         if (item.creator_id === session.id && item.creator_revoked !== true) return true;

//         const key = item.type === 'folder' ? `fol_${item.id}` : `doc_${item.id}`;
//         return mergedPerms[key]?.[action] === true;
//     };

//     // ── DERIVED STATE ────────────────────────────────────────────────────────
//     const breadcrumbPath = useMemo(() => {
//         const path = []; let id = currentFolderId;
//         while (id !== null) {
//             const folder = files.find(f => f.id === id);
//             if (folder) { path.unshift(folder); id = folder.parentId; } else break;
//         }
//         return path;
//     }, [currentFolderId, files]);


//     // ── ACTIVE DB INDEX (FOR FILES/BOOKMARKS/DOWNLOADS) ──────────────────────
//     const getActiveDisplayIndex = useCallback((f) => {
//         if (f.type !== 'folder') return f.index && f.index !== '99' ? f.index : '—';
//         const path = [];
//         let curr = f;
//         let depth = 0;
//         while (curr && depth < 10) {
//             path.unshift((curr.index || '1').toString().trim());
//             if (!curr.parentId || curr.parentId === 'root') break;
//             curr = files.find(x => x.id === curr.parentId);
//             depth++;
//         }
//         return path.join('.') || '—';
//     }, [files]);

//     const currentItems = useMemo(() => {
//         const raw = (() => {
//             if (currentView === 'trash') return files.filter(f => deletedIds.has(f.id));
//             if (currentView === 'bookmarks') return files.filter(f => bookmarkedIds.has(f.id) && !deletedIds.has(f.id));
//             if (currentView === 'downloads') return files.filter(f => downloadedIds.has(f.id) && !deletedIds.has(f.id));
//             return files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
//         })();
//         return raw.map(f => ({
//             ...f,
//             displayIndex: getActiveDisplayIndex(f)
//         }));
//     }, [currentFolderId, files, currentView, deletedIds, bookmarkedIds, downloadedIds, getActiveDisplayIndex]);

//     const filteredItems = useMemo(() => {
//         return currentItems
//             .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
//             .sort((a, b) => {
//                 // Sort by displayIndex hierarchically
//                 const aParts = (a.displayIndex || '999999').toString().split('.').map(Number);
//                 const bParts = (b.displayIndex || '999999').toString().split('.').map(Number);
//                 for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
//                     const av = aParts[i] === undefined ? 0 : (isNaN(aParts[i]) ? 999999 : aParts[i]);
//                     const bv = bParts[i] === undefined ? 0 : (isNaN(bParts[i]) ? 999999 : bParts[i]);
//                     if (av !== bv) return av - bv;
//                 }
//                 return 0;
//             });
//     }, [currentItems, searchQuery]);
//     const selectedItemsArray = files.filter(f => selectedIds.has(f.id));

//     // Nav Bar Logic Flags
//     const selectionEnabled = !['bookmarks', 'downloads'].includes(currentView);

//     // const canUploadHere = currentFolderId === null ? canUser('can_upload') : canUser('can_upload', { type: 'folder', id: currentFolderId });
//     // const canEditSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => canUser('can_edit', item));
//     // const canDownloadSecureSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type !== 'folder' && canUser('can_download_secure', item));
//     // const canDownloadOriginalSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type !== 'folder' && canUser('can_download_original', item));
//     // const canDeleteSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => canUser('can_delete', item)); // 🔥 Added Delete Flag

//     const isGod = session?.role === 'super_admin';

//     const canUploadHere = currentFolderId === null ? canUser('can_upload') : canUser('can_upload', { type: 'folder', id: currentFolderId });
//     const canCreateFolder = isGod || globalFolderPerms.can_create;
//     const canMergeFolder = isGod || globalFolderPerms.can_merge;

//     const canDownloadSecureSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type !== 'folder' && canUser('can_download_secure', item));
//     const canDownloadOriginalSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => item.type !== 'folder' && canUser('can_download_original', item));

//     // Delete logic checks if it's a folder (needs folder_delete) or a file (needs file_delete)
//     const canDeleteSelected = selectedItemsArray.length > 0 && selectedItemsArray.every(item => {
//         if (item.type === 'folder') return isGod || globalFolderPerms.can_delete;
//         return canUser('can_delete', item);
//     });

//     // ── HANDLERS ─────────────────────────────────────────────────────────────
//     const handleToggleSelect = (id, e) => {
//         e.stopPropagation();
//         setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
//     };

//     const handleSelectAll = () => setSelectedIds(prev => prev.size === filteredItems.length ? new Set() : new Set(filteredItems.map(f => f.id)));

//     const handleToggleBookmark = async (item, e) => {
//         e.stopPropagation();
//         try {
//             const isBookmarked = bookmarkedIds.has(item.id);
//             const table = item.type === 'folder' ? 'folders' : 'documents';
//             await supabase.from(table).update({ is_bookmarked: !isBookmarked }).eq('id', item.id);
//             setBookmarkedIds(prev => {
//                 const n = new Set(prev);
//                 if (isBookmarked) n.delete(item.id);
//                 else n.add(item.id);
//                 return n;
//             });
//         } catch (err) { console.error('Bookmark toggle failed', err); }
//     };

//     // ── Q&A REDIRECT HANDLER ───────────────────────────────────────────────
//     const handleGoToQA = async (item, e) => {
//         e.stopPropagation();
//         if (item.type === 'folder') {
//             router.push(`/qa?folderId=${item.id}`);
//         } else {
//             // Log access to document_access_logs
//             if (session) {
//                 await supabase.from('document_access_logs').insert([{
//                     user_id: session.id,
//                     document_id: item.id
//                 }]);
//             }
//             router.push(`/qa?fileId=${item.id}`);
//         }
//     };

//     const handleItemClick = (item) => {
//         if (item.type === 'folder') {
//             setCurrentFolderId(item.id); setSelectedIds(new Set()); setSearchQuery('');
//         } else {
//             handleToggleSelect(item.id, { stopPropagation: () => { } });
//         }
//     };

//     // ... (File Upload & Fernet Encryption Logic remains exactly the same) ...


//     // const handleFileChange = async (e) => {
//     //     const chosenFiles = Array.from(e.target.files);
//     //     if (chosenFiles.length === 0 || !session) return;

//     //     setUploadQueue(chosenFiles.map((f, i) => ({
//     //         id: `up-${Date.now()}-${i}`, name: f.name, progress: 0, status: 'uploading',
//     //         size: formatBytes(f.size)
//     //     })));
//     //     setIsUploadModalOpen(true);

//     //     const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
//     //         const reader = new FileReader();
//     //         reader.onload = () => resolve(reader.result.split(',')[1]);
//     //         reader.onerror = reject;
//     //         reader.readAsDataURL(file);
//     //     });

//     //     const peers = files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
//     //     let nextIndex = peers.reduce((m, it) => Math.max(m, parseInt(it.index) || 0), 0) + 1;

//     //     for (let i = 0; i < chosenFiles.length; i++) {
//     //         const file = chosenFiles[i];
//     //         try {
//     //             // 1. Define Dual Paths
//     //             const secureStoragePath = `${session.company_id}/secure_${Date.now()}_${file.name}`;
//     //             const originalStoragePath = `${session.company_id}/original_${Date.now()}_${file.name}`;

//     //             // 2. Upload RAW Original to new bucket
//     //             const { error: origErr } = await supabase.storage.from('original-files').upload(originalStoragePath, file);
//     //             if (origErr) throw new Error("Original Upload Failed: " + origErr.message);

//     //             // 3. Encrypt and Upload SECURE to vault-files
//     //             const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
//     //             const fernetKey = btoa(String.fromCharCode(...randomBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
//     //             const base64Data = await readFileAsBase64(file);
//     //             const secret = new fernet.Secret(fernetKey);
//     //             const token = new fernet.Token({ secret: secret });
//     //             const encryptedString = token.encode(base64Data);

//     //             const encryptedBlob = new Blob([encryptedString], { type: 'text/plain' });
//     //             const { error: secureErr } = await supabase.storage.from('vault-files').upload(secureStoragePath, encryptedBlob, { contentType: 'text/plain' });
//     //             if (secureErr) throw new Error("Secure Upload Failed: " + secureErr.message);

//     //             // 4. Hit API Route (Saves standard metadata)
//     //             const res = await fetch('/api/documents/upload', {
//     //                 method: 'POST', headers: { 'Content-Type': 'application/json' },
//     //                 body: JSON.stringify({
//     //                     company_id: session.company_id, folder_id: currentFolderId, uploaded_by: session.id,
//     //                     name: file.name, file_path: secureStoragePath, mime_type: file.type || 'application/octet-stream',
//     //                     file_size_bytes: file.size, dek_ref: fernetKey, index: nextIndex.toString(), security: 'Fernet Encrypted'
//     //                 })
//     //             });

//     //             if (!res.ok) throw new Error('DB API Sync failed');
//     //             const { id: docId } = await res.json();

//     //             // 5. Explicitly update the original path in DB just in case the API doesn't know about it yet
//     //             await supabase.from('documents').update({ original_file_path: originalStoragePath }).eq('id', docId);

//     //             // 6. Update UI
//     //             setUploadQueue(prev => prev.map((it, idx) => idx === i ? { ...it, progress: 100, status: 'completed' } : it));
//     //             setFiles(prev => [...prev, {
//     //                 id: docId, parentId: currentFolderId, index: nextIndex.toString(), name: file.name,
//     //                 type: file.name.split('.').pop().toLowerCase() || 'file',
//     //                 size: formatBytes(file.size),
//     //                 uploadedBy: session.name, dateCreated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
//     //                 file_path: secureStoragePath, original_file_path: originalStoragePath, dek_ref: fernetKey, mime_type: file.type
//     //             }]);

//     //             nextIndex++; // Increment for the next file in the loop
//     //         } catch (err) {
//     //             console.error('Upload failed:', err);
//     //             alert("Upload error for " + file.name + ": " + err.message);
//     //             setUploadQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error' } : it));
//     //         }
//     //     }
//     //     setTimeout(() => { setUploadQueue([]); setIsUploadModalOpen(false); e.target.value = ''; }, 1500);
//     // };

//     const processFilesForUpload = async (chosenFiles) => {
//         if (chosenFiles.length === 0 || !session) return;

//         setUploadQueue(chosenFiles.map((f, i) => ({
//             id: `up-${Date.now()}-${i}`, name: f.name, progress: 0, status: 'uploading',
//             size: formatBytes(f.size)
//         })));
//         setIsUploadModalOpen(true);

//         let prefix = '';
//         if (currentFolderId) {
//             const parentFolder = files.find(f => f.id === currentFolderId);
//             if (parentFolder && parentFolder.index && parentFolder.index !== '99') {
//                 prefix = `${parentFolder.index}.`;
//             }
//         }

//         const peers = files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
//         let nextIndex = peers.reduce((m, it) => {
//             const lastPart = it.index ? it.index.toString().split('.').pop() : '0';
//             return Math.max(m, parseInt(lastPart, 10) || 0);
//         }, 0) + 1;

//         for (let i = 0; i < chosenFiles.length; i++) {
//             const file = chosenFiles[i];
//             try {
//                 const formData = new FormData();
//                 formData.append('file', file);
//                 formData.append('company_id', session.company_id);
//                 formData.append('folder_id', currentFolderId || '');
//                 formData.append('uploaded_by', session.id);
//                 formData.append('index', `${prefix}${nextIndex}`);

//                 const res = await fetch('/api/documents/upload', {
//                     method: 'POST',
//                     body: formData
//                 });

//                 const result = await res.json();
//                 if (!res.ok) throw new Error(result.error || 'Server conversion failed');

//                 setUploadQueue(prev => prev.map((it, idx) => idx === i ? { ...it, progress: 100, status: 'completed' } : it));
//                 nextIndex++;

//             } catch (err) {
//                 console.error('Upload failed:', err);
//                 setUploadQueue(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error' } : it));
//             }
//         }
//         // After all uploads: fetch fresh docs, rebuild index properly, then reload
//         setTimeout(async () => {
//             setUploadQueue([]);
//             setIsUploadModalOpen(false);
//             try {
//                 // Fetch all fresh docs from Supabase (including newly uploaded ones)
//                 const existingIds = new Set(files.map(f => f.id));
//                 const { data: freshDocs } = await supabase
//                     .from('documents')
//                     .select('*')
//                     .eq('company_id', session.company_id)
//                     .eq('is_deleted', false);

//                 const { data: usersData } = await supabase
//                     .from('users')
//                     .select('id, name')
//                     .eq('company_id', session.company_id);

//                 const userMap = {};
//                 (usersData || []).forEach(u => userMap[u.id] = u.name);

//                 // Map new docs (not already in state) to our file shape
//                 const newDocsMapped = (freshDocs || [])
//                     .filter(doc => !existingIds.has(doc.id))
//                     .map(doc => ({
//                         id: doc.id,
//                         parentId: doc.folder_id || null,
//                         index: doc.index ? doc.index.toString().replace('.0', '') : '99',
//                         name: doc.name,
//                         type: doc.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/gi, '') || 'file',
//                         size: formatBytes(doc.file_size_bytes),
//                         uploadedBy: userMap[doc.uploaded_by] || session.name,
//                         dateCreated: new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
//                         deletedBy: '', deletedAt: '--',
//                         is_bookmarked: doc.is_bookmarked,
//                         is_downloaded: doc.is_downloaded,
//                         is_deleted: doc.is_deleted,
//                         file_path: doc.file_path,
//                         original_file_path: doc.original_file_path,
//                         dek_ref: doc.dek_ref,
//                         mime_type: doc.mime_type,
//                         creator_id: doc.uploaded_by,
//                         creator_revoked: doc.creator_revoked,
//                         version: parseInt(doc.version) || 1
//                     }));

//                 // Merge and trigger a full reindex → this will save correct indices to DB and reload
//                 const mergedFiles = [...files, ...newDocsMapped];
//                 await executeRebuildIndex(mergedFiles, deletedIds, true);
//             } catch (err) {
//                 console.error('Post-upload reindex failed:', err);
//                 window.location.reload();
//             }
//         }, 1500);
//     };

//     const handleFileChange = async (e) => {
//         processFilesForUpload(Array.from(e.target.files));
//     };

//     const [isDraggingOverScreen, setIsDraggingOverScreen] = useState(false);

//     const handleWindowDragOver = (e) => {
//         e.preventDefault();
//         // Only allow dropping files, not other dragged items within the app
//         if (e.dataTransfer.types.includes('Files')) {
//             setIsDraggingOverScreen(true);
//             e.dataTransfer.dropEffect = 'copy';
//         }
//     };

//     const handleWindowDragLeave = (e) => {
//         e.preventDefault();
//         // Ignore events from child elements
//         if (e.currentTarget.contains(e.relatedTarget)) return;
//         setIsDraggingOverScreen(false);
//     };

//     const handleWindowDrop = (e) => {
//         e.preventDefault();
//         setIsDraggingOverScreen(false);
//         if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
//             processFilesForUpload(Array.from(e.dataTransfer.files));
//         }
//     };

//     // ── DRAG AND DROP REORDERING ──────────────────────────────────────────────
//     const handleDragStart = (e, item) => {
//         if (currentView !== 'files') return;
//         e.dataTransfer.setData('text/plain', item.id);
//         e.dataTransfer.effectAllowed = 'move';
//     };

//     const handleDragOver = (e) => {
//         if (currentView !== 'files') return;
//         e.preventDefault();
//         e.dataTransfer.dropEffect = 'move';
//     };

//     const showToast = (message, type = 'success') => {
//         setToast({ message, type });
//         setTimeout(() => setToast(null), 3000);
//     };

//     const handleDropToFolder = async (e, folderId) => {
//         if (currentView !== 'files') return;
//         e.preventDefault();
//         const sourceId = e.dataTransfer.getData('text/plain');
//         if (!sourceId) return;

//         const sourceItem = files.find(f => f.id === sourceId);
//         if (!sourceItem || sourceItem.parentId === folderId) return; // already in this folder

//         const updatedFiles = files.map(f => ({ ...f }));
//         const sourceIdxInUpdated = updatedFiles.findIndex(f => f.id === sourceId);

//         if (sourceIdxInUpdated > -1) {
//             updatedFiles[sourceIdxInUpdated].parentId = folderId;
//             updatedFiles[sourceIdxInUpdated].index = '999999';
//         }

//         setFiles(updatedFiles);

//         try {
//             const table = sourceItem.type === 'folder' ? 'folders' : 'documents';
//             await supabase.from(table).update({ folder_id: folderId === 'root' || folderId === null ? null : folderId }).eq('id', sourceId);

//             await executeRebuildIndex(updatedFiles, deletedIds, true);
//             showToast('Index updated successfully ✓');
//         } catch (err) {
//             console.error('Failed to move', err);
//             showToast('Failed to move: ' + err.message, 'error');
//         }
//     };

//     const handleDrop = async (e, targetItem) => {
//         if (currentView !== 'files') return;
//         e.preventDefault();
//         const sourceId = e.dataTransfer.getData('text/plain');
//         if (!sourceId || sourceId === targetItem.id) return;

//         const sourceItem = files.find(f => f.id === sourceId);
//         if (!sourceItem) return;

//         const updatedFiles = files.map(f => ({ ...f }));
//         const sourceIdxInUpdated = updatedFiles.findIndex(f => f.id === sourceId);

//         let newParentId = targetItem.parentId;
//         let isMovingIntoFolder = false;

//         if (targetItem.type === 'folder') {
//             if (sourceItem.parentId === targetItem.id) {
//                 return; // Already in this folder, no op on drop
//             }
//             newParentId = targetItem.id;
//             isMovingIntoFolder = true;
//         }

//         if (updatedFiles[sourceIdxInUpdated].parentId !== newParentId) {
//             updatedFiles[sourceIdxInUpdated].parentId = newParentId;
//             updatedFiles[sourceIdxInUpdated].index = '999999'; 
//         }

//         if (!isMovingIntoFolder) {
//             const siblings = updatedFiles.filter(f => f.parentId === newParentId && !deletedIds.has(f.id)).sort(sortItemsByIndex);
//             const sourceIdx = siblings.findIndex(f => f.id === sourceId);
//             const targetIdx = siblings.findIndex(f => f.id === targetItem.id);

//             if (sourceIdx !== -1 && targetIdx !== -1) {
//                 const newSiblings = [...siblings];
//                 const [removed] = newSiblings.splice(sourceIdx, 1);
//                 newSiblings.splice(targetIdx, 0, removed);

//                 newSiblings.forEach((sib, i) => {
//                     const fIdx = updatedFiles.findIndex(x => x.id === sib.id);
//                     if (fIdx > -1) {
//                         updatedFiles[fIdx].index = (i + 1).toString();
//                     }
//                 });
//             }
//         }

//         setFiles(updatedFiles);

//         try {
//             if (sourceItem.parentId !== newParentId) {
//                 const table = sourceItem.type === 'folder' ? 'folders' : 'documents';
//                 await supabase.from(table).update({ folder_id: newParentId === 'root' ? null : newParentId }).eq('id', sourceId);
//             }

//             await executeRebuildIndex(updatedFiles, deletedIds, true);
//             showToast('Index updated successfully ✓');
//         } catch (err) {
//             console.error('Failed to update order or move', err);
//             showToast('Failed to update order: ' + err.message, 'error');
//         }
//     };

//     // ── REBUILD INDEX ─────────────────────────────────────────────────────────
//     const executeRebuildIndex = async (overrideFiles = null, overrideDeletedIds = null, shouldReload = true) => {
//         setIsRebuildIndexModalOpen(false);
//         setIsRebuilding(true);
//         try {
//             // Guard: only accept real arrays/Sets, never event objects
//             const currentFiles = Array.isArray(overrideFiles) ? overrideFiles : files;
//             const currentDeletedIds = overrideDeletedIds instanceof Set ? overrideDeletedIds : deletedIds;

//             // Only active (non-deleted) items
//             const activeItems = currentFiles.filter(f => !currentDeletedIds.has(f.id));

//             // Group by parent — mirrors stableIndexMap logic
//             const byParent = {};
//             activeItems.forEach(f => {
//                 const pId = f.parentId || 'root';
//                 if (!byParent[pId]) byParent[pId] = [];
//                 byParent[pId].push(f);
//             });

//             // Sort each group: folders first, then by existing index number
//             Object.values(byParent).forEach(group => {
//                 group.sort(sortItemsByIndex);
//             });

//             const folderUpdates = [];
//             const docUpdates = [];

//             // To update local state correctly when not reloading
//             const localUpdates = new Map();

//             // Recursively assign sequential indexes (identical to stableIndexMap)
//             const assignIndexes = (parentId, prefix) => {
//                 const group = byParent[parentId] || [];
//                 group.forEach((item, idx) => {
//                     const newIndex = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
//                     if (item.type === 'folder') {
//                         folderUpdates.push({ id: item.id, index_number: idx + 1 });
//                         localUpdates.set(item.id, (idx + 1).toString());
//                         assignIndexes(item.id, newIndex);
//                     } else {
//                         docUpdates.push({ id: item.id, index: newIndex });
//                         localUpdates.set(item.id, newIndex);
//                     }
//                 });
//             };
//             assignIndexes('root', '');

//             // Bulk update Supabase
//             if (folderUpdates.length > 0) {
//                 await Promise.all(folderUpdates.map(u =>
//                     supabase.from('folders').update({ index_number: u.index_number }).eq('id', u.id)
//                 ));
//             }
//             if (docUpdates.length > 0) {
//                 await Promise.all(docUpdates.map(u =>
//                     supabase.from('documents').update({ index: u.index }).eq('id', u.id)
//                 ));
//             }

//             if (shouldReload) {
//                 window.location.reload();
//             } else {
//                 setFiles(prev => prev.map(f => {
//                     if (localUpdates.has(f.id)) {
//                         return { ...f, index: localUpdates.get(f.id) };
//                     }
//                     return f;
//                 }));
//                 setIsRebuilding(false);
//             }
//         } catch (err) {
//             console.error('Rebuild Index failed:', err);
//             alert("Failed to rebuild index: " + err.message);
//             setIsRebuilding(false);
//         }
//     };

//     const handleCreateFolder = async (e) => {
//         e.preventDefault();
//         if (!newFolderName.trim()) return;
//         try {
//             const peers = files.filter(f => f.parentId === currentFolderId && !deletedIds.has(f.id));
//             let newIndex = peers.reduce((m, it) => {
//                 const lastPart = it.index ? it.index.toString().split('.').pop() : '0';
//                 return Math.max(m, parseInt(lastPart) || 0);
//             }, 0) + 1;

//             const { data: dbFolder, error } = await supabase.from('folders').insert({
//                 company_id: session.company_id, parent_folder_id: currentFolderId,
//                 name: newFolderName.trim(), index_number: parseInt(newIndex) || 1, created_by: session.id,
//             }).select().single();

//             if (error) throw error;

//             const newFiles = [...files, {
//                 id: dbFolder.id, parentId: dbFolder.parent_folder_id || null, index: newIndex.toString(),
//                 name: dbFolder.name, type: 'folder', size: formatBytes(0), uploadedBy: session.name,
//                 dateCreated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
//             }];
//             setFiles(newFiles);
//             setNewFolderName(''); setIsNewFolderOpen(false);

//             // Auto-reindex after adding new folder
//             await executeRebuildIndex(newFiles, deletedIds);
//         } catch (err) {
//             alert("Failed to create folder: " + err.message);
//         }
//     };

//     const handleRename = async (e) => {
//         e.preventDefault();
//         if (!renameValue.trim() || selectedIds.size !== 1) return;
//         const itemId = [...selectedIds][0];
//         const item = files.find(f => f.id === itemId);
//         if (!item) return;

//         try {
//             const newVersion = (parseInt(item.version) || 1) + 1;
//             if (item.type === 'folder') {
//                 await supabase.from('folders').update({ name: renameValue.trim(), version: newVersion }).eq('id', itemId);
//             } else {
//                 await supabase.from('documents').update({ name: renameValue.trim(), version: newVersion }).eq('id', itemId);
//             }
//             setFiles(prev => prev.map(f => f.id === itemId ? { ...f, name: renameValue.trim(), version: newVersion } : f));
//             setIsRenameModalOpen(false);
//             setSelectedIds(new Set());
//         } catch (err) {
//             alert("Failed to rename: " + err.message);
//         }
//     };
//     //const handleCreateFolder = async (e) => { /* Your Folder create logic */ };

//     // const executeDownload = async (type) => {
//     //     setIsDownloadMenuOpen(false);
//     //     for (let id of selectedIds) {
//     //         const file = files.find(f => f.id === id);
//     //         if (!file || file.type === 'folder') continue;

//     //         setDownloading(prev => ({ ...prev, [file.id]: true }));
//     //         try {
//     //             if (type === 'secure') {
//     //                 // Generates the .vdr keycard for your Electron App
//     //                 const blob = new Blob([file.id], { type: 'text/plain' });
//     //                 const url = URL.createObjectURL(blob);
//     //                 const a = document.createElement('a'); a.href = url; a.download = `${file.name}.vdr`;
//     //                 document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //                 await supabase.from('documents').update({ is_downloaded: true }).eq('id', file.id);
//     //             }
//     //             else if (type === 'original') {
//     //                 // NEW FAST PATH: Direct Original Bucket Download!
//     //                 if (file.original_file_path) {
//     //                     const { data, error } = await supabase.storage.from('original-files').download(file.original_file_path);
//     //                     if (error) throw error;
//     //                     const url = URL.createObjectURL(data);
//     //                     const a = document.createElement('a'); a.href = url; a.download = file.name;
//     //                     document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //                 } else {
//     //                     // FALLBACK: For old files uploaded before we added the dual-bucket feature
//     //                     const { data, error } = await supabase.storage.from('vault-files').download(file.file_path);
//     //                     if (error) throw error;
//     //                     const text = await data.text();
//     //                     const secret = new fernet.Secret(file.dek_ref);
//     //                     const token = new fernet.Token({ secret: secret, token: text, ttl: 0 });
//     //                     const decryptedBase64 = token.decode();
//     //                     const byteCharacters = atob(decryptedBase64);
//     //                     const byteNumbers = new Array(byteCharacters.length);
//     //                     for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
//     //                     const blob = new Blob([new Uint8Array(byteNumbers)], { type: file.mime_type || 'application/octet-stream' });
//     //                     const url = URL.createObjectURL(blob);
//     //                     const a = document.createElement('a'); a.href = url; a.download = file.name;
//     //                     document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //                 }
//     //             }
//     //         } catch (err) { alert(`Download failed for ${file.name}: ${err.message}`); }
//     //         finally { setDownloading(prev => { const n = { ...prev }; delete n[file.id]; return n; }); }
//     //     }
//     // };


//     // const executeDownload = async (type) => {
//     //     setIsDownloadMenuOpen(false);
//     //     for (let id of selectedIds) {
//     //         const file = files.find(f => f.id === id);
//     //         if (!file || file.type === 'folder') continue;

//     //         setDownloading(prev => ({ ...prev, [file.id]: true }));
//     //         try {
//     //             if (type === 'secure') {
//     //                 // Generates the .vdr keycard for your Electron App
//     //                 const blob = new Blob([file.id], { type: 'text/plain' });
//     //                 const url = URL.createObjectURL(blob);
//     //                 const a = document.createElement('a'); a.href = url; a.download = `${file.name}.vdr`;
//     //                 document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //                 await supabase.from('documents').update({ is_downloaded: true }).eq('id', file.id);
//     //             }
//     //             else if (type === 'original') {
//     //                 // 🔥 NEW FAST PATH: Direct Original Bucket Download!
//     //                 if (file.original_file_path) {
//     //                     const { data, error } = await supabase.storage.from('original-files').download(file.original_file_path);
//     //                     if (error) throw error;
//     //                     const url = URL.createObjectURL(data);
//     //                     const a = document.createElement('a'); a.href = url; a.download = file.name;
//     //                     document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //                 } else {
//     //                     // FALLBACK: For old files uploaded before we added the dual-bucket feature
//     //                     const { data, error } = await supabase.storage.from('vault-files').download(file.file_path);
//     //                     if (error) throw error;
//     //                     const text = await data.text();
//     //                     const secret = new fernet.Secret(file.dek_ref);
//     //                     const token = new fernet.Token({ secret: secret, token: text, ttl: 0 });
//     //                     const decryptedBase64 = token.decode();
//     //                     const byteCharacters = atob(decryptedBase64);
//     //                     const byteNumbers = new Array(byteCharacters.length);
//     //                     for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
//     //                     const blob = new Blob([new Uint8Array(byteNumbers)], { type: file.mime_type || 'application/octet-stream' });
//     //                     const url = URL.createObjectURL(blob);
//     //                     const a = document.createElement('a'); a.href = url; a.download = file.name;
//     //                     document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //                 }
//     //             }
//     //         } catch (err) { alert(`Download failed for ${file.name}: ${err.message}`); }
//     //         finally { setDownloading(prev => { const n = { ...prev }; delete n[file.id]; return n; }); }
//     //     }
//     // };


//     // ── DOWNLOAD (Generates HTML Wrapper for Vault files) ──
//     const executeDownloadWrapper = async (actionType) => {
//         setIsDownloadMenuOpen(false);
//         for (let id of selectedIds) {
//             const file = files.find(f => f.id === id);
//             if (!file || file.type === 'folder') continue;

//             setDownloading(prev => ({ ...prev, [file.id]: true }));
//             try {
//                 if (actionType === 'secure' || actionType === 'view' || actionType === 'edit') {
//                     // We map 'secure' to 'view' by default for the dropdown
//                     const resolvedAction = actionType === 'secure' ? 'view' : actionType;

//                     // 1. Fetch encrypted payload from Supabase vault
//                     const { data, error } = await supabase.storage.from('vault-files').download(file.file_path);
//                     if (error) throw error;
//                     const encryptedPayload = await data.text();

//                     // 2. Generate HTML Wrapper (Pass 'view' or 'edit' based on button clicked)
//                     //const htmlBlob = generateSecureHtmlWrapper(file.id, file.name, encryptedPayload, resolvedAction);
//                     // // 🔥 Passed file.type directly to the engine!
//                     // const htmlBlob = generateSecureHtmlWrapper(file.id, file.name, file.type, encryptedPayload);
//                     // const url = URL.createObjectURL(htmlBlob);

//                     // 2. Generate HTML Wrapper (Pass 'view' or 'edit' based on button clicked)
//                     const rawContent = generateSecureHtmlWrapper(file.id, file.name, file.type, encryptedPayload);

//                     // 🔥 THE FIX: Guarantee it is a Blob object so the browser doesn't crash!
//                     const htmlBlob = rawContent instanceof Blob ? rawContent : new Blob([rawContent], { type: 'text/html' });
//                     const url = URL.createObjectURL(htmlBlob);

//                     // 3. Trigger Download of the .html file
//                     const a = document.createElement('a'); a.href = url;
//                     const cleanName = file.name.split('.')[0];
//                     const suffix = resolvedAction === 'edit' ? 'Editor' : 'SecureView';
//                     a.download = `${cleanName}_${suffix}.html`;

//                     document.body.appendChild(a); a.click(); document.body.removeChild(a);
//                     URL.revokeObjectURL(url);

//                     await supabase.from('documents').update({ is_downloaded: true }).eq('id', file.id);

//                     if (session) {
//                         await supabase.from('document_edit_logs').insert([{
//                             user_id: session.id,
//                             document_id: file.id,
//                             action_type: 'DOWNLOAD_PDF'
//                         }]);
//                     }
//                 }


//                 else if (actionType === 'original') {
//                     // Downloads native Excel/Word file directly
//                     if (file.original_file_path) {
//                         const { data, error } = await supabase.storage.from('original-files').download(file.original_file_path);
//                         if (error) throw error;

//                         // 🔥 THE FIX: Wrap the original file data in a Blob just to be 100% safe
//                         const originalBlob = data instanceof Blob ? data : new Blob([data]);
//                         const url = URL.createObjectURL(originalBlob);

//                         const a = document.createElement('a');
//                         a.href = url;
//                         a.download = file.name;
//                         document.body.appendChild(a);
//                         a.click();
//                         document.body.removeChild(a);
//                         URL.revokeObjectURL(url);
//                     } else {
//                         alert("Original file not found.");
//                     }

//                     if (session) {
//                         await supabase.from('document_edit_logs').insert([{
//                             user_id: session.id,
//                             document_id: file.id,
//                             action_type: 'DOWNLOAD_ORIGINAL'
//                         }]);
//                     }
//                 }
//             } catch (err) {
//                 alert(`Download failed for ${file.name}: ${err.message}`);
//             } finally {
//                 setDownloading(prev => { const n = { ...prev }; delete n[file.id]; return n; });
//             }
//         }
//     };

//     //                 else if (actionType === 'original') {
//     //     // Downloads native Excel/Word file directly
//     //     if (file.original_file_path) {
//     //         const { data, error } = await supabase.storage.from('original-files').download(file.original_file_path);
//     //         if (error) throw error;
//     //         const url = URL.createObjectURL(data);
//     //         const a = document.createElement('a'); a.href = url; a.download = file.name;
//     //         document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
//     //     } else {
//     //         alert("Original file not found.");
//     //     }
//     // }
//     //             } catch (err) { alert(`Download failed for ${file.name}: ${err.message}`); }
//     // finally { setDownloading(prev => { const n = { ...prev }; delete n[file.id]; return n; }); }
//     //         }
//     //     };

//     const handleExport = () => { /* Your CSV logic */ };
//     const executeMoveToFolder = async () => {
//         try {
//             const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//             const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');

//             // Move documents
//             if (docIds.length > 0) await supabase.from('documents').update({ folder_id: movingToFolderId }).in('id', docIds);
//             // Move folders (update parent_folder_id)
//             if (folderIds.length > 0) await supabase.from('folders').update({ parent_folder_id: movingToFolderId }).in('id', folderIds);

//             const newFiles = files.map(f => selectedIds.has(f.id) ? { ...f, parentId: movingToFolderId } : f);
//             setFiles(newFiles);
//             setSelectedIds(new Set());
//             setIsMoveModalOpen(false);

//             // Automatically trigger reindex
//             await executeRebuildIndex(newFiles, deletedIds);
//         } catch (err) { alert('Move failed: ' + err.message); }
//     };
//     // const executeMoveToFolder = async () => {
//     //     try {
//     //         const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//     //         const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');

//     //         // Move documents
//     //         if (docIds.length > 0) {
//     //             const { error } = await supabase.from('documents').update({ folder_id: movingToFolderId }).in('id', docIds);
//     //             if (error) throw new Error("Doc Move Error: " + error.message);
//     //         }
//     //         // Move folders
//     //         if (folderIds.length > 0) {
//     //             const { error } = await supabase.from('folders').update({ parent_folder_id: movingToFolderId }).in('id', folderIds);
//     //             if (error) throw new Error("Folder Move Error: " + error.message);
//     //         }

//     //         setFiles(prev => prev.map(f => selectedIds.has(f.id) ? { ...f, parentId: movingToFolderId } : f));
//     //         setSelectedIds(new Set());
//     //         setIsMoveModalOpen(false);
//     //     } catch (err) { alert('Move failed: ' + err.message); }
//     // };

//     const executeSoftDelete = async () => {
//         try {
//             const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//             const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');

//             if (docIds.length > 0) {
//                 await supabase.from('documents').update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: session.id }).in('id', docIds);
//             }

//             if (folderIds.length > 0) {
//                 await supabase.from('folders').update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: session.id }).in('id', folderIds);
//             }

//             // Add to trash tracker
//             const allDeleted = [...docIds, ...folderIds];
//             const newDeletedIds = new Set(deletedIds);
//             allDeleted.forEach(id => newDeletedIds.add(id));
//             setDeletedIds(newDeletedIds);

//             // Update UI: Keep them in the files array, just mark them as deleted (don't filter them out!)
//             const newFiles = files.map(f => selectedIds.has(f.id) ? { ...f, deletedBy: session.name, deletedAt: new Date().toLocaleDateString() } : f);
//             setFiles(newFiles);

//             setSelectedIds(new Set());
//             setIsDeleteModalOpen(false);

//             // Automatically trigger reindex
//             await executeRebuildIndex(newFiles, newDeletedIds);
//         } catch (err) {
//             alert('Trash failed: ' + err.message);
//             console.error('Trash failed', err);
//         }
//     };

//     const executeRecover = async () => {
//         try {
//             const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//             const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');

//             if (docIds.length > 0) await supabase.from('documents').update({ is_deleted: false, deleted_at: null, deleted_by: null }).in('id', docIds);
//             if (folderIds.length > 0) await supabase.from('folders').update({ is_deleted: false, deleted_at: null, deleted_by: null }).in('id', folderIds);

//             const newDeletedIds = new Set(deletedIds);
//             [...docIds, ...folderIds].forEach(id => newDeletedIds.delete(id));
//             setDeletedIds(newDeletedIds);

//             setSelectedIds(new Set());

//             // Automatically trigger reindex
//             await executeRebuildIndex(files, newDeletedIds);
//         } catch (err) { alert('Recover failed: ' + err.message); }
//     };

//     const executePermanentDelete = async () => {
//         try {
//             const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//             const folderIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type === 'folder');

//             if (docIds.length > 0) await supabase.from('documents').delete().in('id', docIds);
//             if (folderIds.length > 0) await supabase.from('folders').delete().in('id', folderIds);

//             const newFiles = files.filter(f => !selectedIds.has(f.id));
//             const newDeletedIds = new Set(deletedIds);
//             [...docIds, ...folderIds].forEach(id => newDeletedIds.delete(id));

//             setFiles(newFiles);
//             setDeletedIds(newDeletedIds);

//             setSelectedIds(new Set());
//             setIsPermDeleteModalOpen(false);

//             // Automatically trigger reindex
//             await executeRebuildIndex(newFiles, newDeletedIds);
//         } catch (err) { alert('Permanent delete failed: ' + err.message); }
//     };
//     // const executeSoftDelete = async () => {
//     //     try {
//     //         const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//     //         if (docIds.length > 0) {
//     //             await supabase.from('documents').update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: session.id }).in('id', docIds);
//     //             setDeletedIds(prev => { const n = new Set(prev); docIds.forEach(id => n.add(id)); return n; });
//     //             setFiles(prev => prev.map(f => docIds.includes(f.id) ? { ...f, deletedBy: session.name, deletedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } : f));
//     //         }
//     //         setSelectedIds(new Set());
//     //         setIsDeleteModalOpen(false);
//     //     } catch (err) { console.error('Trash failed', err); }
//     // };

//     // const executeRecover = async () => {
//     //     try {
//     //         const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//     //         if (docIds.length > 0) {
//     //             await supabase.from('documents').update({ is_deleted: false, deleted_at: null, deleted_by: null }).in('id', docIds);
//     //             setDeletedIds(prev => { const n = new Set(prev); docIds.forEach(id => n.delete(id)); return n; });
//     //         }
//     //         setSelectedIds(new Set());
//     //     } catch (err) { console.error('Recover failed', err); }
//     // };

//     // const executePermanentDelete = async () => {
//     //     try {
//     //         const docIds = [...selectedIds].filter(id => files.find(f => f.id === id)?.type !== 'folder');
//     //         if (docIds.length > 0) {
//     //             await supabase.from('documents').delete().in('id', docIds);
//     //             setFiles(prev => prev.filter(f => !docIds.includes(f.id)));
//     //             setDeletedIds(prev => { const n = new Set(prev); docIds.forEach(id => n.delete(id)); return n; });
//     //         }
//     //         setSelectedIds(new Set());
//     //         setIsPermDeleteModalOpen(false);
//     //     } catch (err) { console.error('Permanent delete failed', err); }
//     // };

//     // ── ACCESS CONTROL FLAGS FOR BUTTON VISIBILITY ──

//     const hasAnyRenameAccess = isGod || canUser('can_edit', { type: 'folder', id: currentFolderId }) || filteredItems.some(f => canUser('can_edit', f));
//     const hasAnyDownloadAccess = isGod || canUser('can_download_secure', { type: 'folder', id: currentFolderId }) || canUser('can_download_original', { type: 'folder', id: currentFolderId }) || filteredItems.some(f => canUser('can_download_secure', f) || canUser('can_download_original', f));
//     const hasAnyDeleteAccess = isGod || globalFolderPerms.can_delete || canUser('can_delete', { type: 'folder', id: currentFolderId }) || filteredItems.some(f => canUser('can_delete', f));
//     const hasAnyExportAccess = isGod || canUser('can_export');

//     if (loading) return <div className="flex items-center justify-center w-full h-full bg-[#FAFBFD]"><div className="w-8 h-8 border-4 border-slate-200 border-t-brand rounded-full animate-spin" /></div>;

//     return (
//         <div 
//             className="flex w-full h-full bg-[#F8F9FB] font-sans relative"
//             onDragOver={handleWindowDragOver}
//             onDragLeave={handleWindowDragLeave}
//             onDrop={handleWindowDrop}
//         >
//             {isDraggingOverScreen && (
//                 <div className="absolute inset-0 z-[100] bg-brand-soft/80 border-4 border-dashed border-brand flex items-center justify-center pointer-events-none">
//                     <div className="bg-white p-8 rounded-2xl shadow-xl flex flex-col items-center gap-4">
//                         <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" className="animate-bounce">
//                             <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
//                             <polyline points="17 8 12 3 7 8" />
//                             <line x1="12" y1="3" x2="12" y2="15" />
//                         </svg>
//                         <h2 className="text-2xl font-black text-slate-800">Drop files here to upload</h2>
//                     </div>
//                 </div>
//             )}

//             {/* ── TOAST NOTIFICATION ── */}
//             {toast && (
//                 <div style={{
//                     position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
//                     display: 'flex', alignItems: 'center', gap: '10px',
//                     padding: '14px 20px', borderRadius: '12px',
//                     boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
//                     background: toast.type === 'error' ? '#FEF2F2' : '#F0FDF4',
//                     border: `1.5px solid ${toast.type === 'error' ? '#FCA5A5' : '#86EFAC'}`,
//                     color: toast.type === 'error' ? '#DC2626' : '#16A34A',
//                     fontSize: '14px', fontWeight: '700',
//                     animation: 'slideInRight 0.3s ease', maxWidth: '340px',
//                 }}>
//                     {toast.type === 'error'
//                         ? <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
//                         : <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
//                     }
//                     {toast.message}
//                 </div>
//             )}
//             <style>{`@keyframes slideInRight { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>

//             {/* Hidden Inputs */}
//             <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />

//             {/* MAIN CONTENT AREA */}
//             <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

//                 {/* ── TOP ACTION BAR (Exact Firmata Match) ── */}
//                 <div className="flex items-center px-6 py-4 bg-white border-b border-slate-200">
//                     <div className="flex items-center gap-3">
//                         {/* 1. UPLOAD BUTTON */}
//                         {!['trash', 'bookmarks', 'downloads'].includes(currentView) && canUploadHere && (
//                             <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors">
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
//                                 Upload
//                             </button>
//                         )}

//                         {/* 2. ADD FOLDER BUTTON (Now independent!) */}
//                         {!['trash', 'bookmarks', 'downloads'].includes(currentView) && canCreateFolder && (
//                             <button onClick={() => setIsNewFolderOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors">
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
//                                 Add Folder
//                             </button>
//                         )}
//                         {/* 3. RENAME BUTTON */}
//                         {!['trash', 'bookmarks', 'downloads'].includes(currentView) && hasAnyRenameAccess && (
//                             <button disabled={selectedIds.size !== 1} onClick={() => {
//                                 const item = files.find(f => f.id === [...selectedIds][0]);
//                                 if (item) {
//                                     setRenameValue(item.name);
//                                     setIsRenameModalOpen(true);
//                                 }
//                             }} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size !== 1 ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-slate-600 hover:bg-brand-soft hover:text-brand'}`}>
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
//                                 Rename
//                             </button>
//                         )}
//                         {/* {!['trash', 'bookmarks', 'downloads'].includes(currentView) && canUploadHere && (
//                             <>
//                                 <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors">
//                                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
//                                     Upload
//                                 </button>

                               
//                                 <button onClick={() => setIsNewFolderOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-brand-soft hover:text-brand rounded-lg transition-colors">
//                                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
//                                     Add Folder
//                                 </button>
//                             </>
//                         )} */}

//                         {/* Download Dropdown Logic */}
//                         {!['trash', 'bookmarks', 'downloads'].includes(currentView) && hasAnyDownloadAccess && (
//                             <div className="relative">
//                                 <button disabled={selectedIds.size === 0} onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-slate-600 hover:bg-brand-soft hover:text-brand'}`}>
//                                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
//                                     Download
//                                     <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`transition-transform ${isDownloadMenuOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
//                                 </button>

//                                 {/* {isDownloadMenuOpen && selectedIds.size > 0 && (
//                                     <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50">
//                                         {canDownloadSecureSelected ? (
//                                             <button onClick={() => executeDownload('secure')} className="w-full text-left px-4 py-2 text-[12px] font-bold text-slate-700 hover:bg-brand-soft">Download Secure (.vdr)</button>
//                                         ) : null}
//                                         {canDownloadOriginalSelected ? (
//                                             <button onClick={() => executeDownload('original')} className="w-full text-left px-4 py-2 text-[12px] font-bold text-slate-700 hover:bg-brand-soft">Download Original</button>
//                                         ) : null}
//                                         {!canDownloadSecureSelected && !canDownloadOriginalSelected && (
//                                             <div className="px-4 py-2 text-[12px] font-medium text-slate-400">No permission</div>
//                                         )}
//                                     </div>
//                                 )} */}

//                                 {isDownloadMenuOpen && selectedIds.size > 0 && (
//                                     <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50">
//                                         {canDownloadSecureSelected ? (
//                                             <button onClick={() => executeDownloadWrapper('secure')} className="w-full text-left px-4 py-2 text-[12px] font-bold text-slate-700 hover:bg-brand-soft">Download Secure (.html)</button>
//                                         ) : null}
//                                         {canDownloadOriginalSelected ? (
//                                             <button onClick={() => executeDownloadWrapper('original')} className="w-full text-left px-4 py-2 text-[12px] font-bold text-slate-700 hover:bg-brand-soft">Download Original</button>
//                                         ) : null}
//                                         {!canDownloadSecureSelected && !canDownloadOriginalSelected && (
//                                             <div className="px-4 py-2 text-[12px] font-medium text-slate-400">No permission</div>
//                                         )}
//                                     </div>
//                                 )}

//                             </div>
//                         )}

//                         {!['trash', 'bookmarks', 'downloads'].includes(currentView) && hasAnyExportAccess && (
//                             <button disabled={selectedIds.size === 0} onClick={handleExport} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-slate-600 hover:bg-brand-soft hover:text-brand'}`}>
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
//                                 Export
//                             </button>
//                         )}

//                         {/* {currentView !== 'trash' && canEditSelected && selectedIds.size > 0 && (
//                             <button onClick={() => setIsDeleteModalOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
//                                 Delete
//                             </button>
//                         )} */}
//                         {/* 🔥 Switched from canEditSelected to canDeleteSelected */}
//                         {currentView !== 'trash' && hasAnyDeleteAccess && (
//                             <button disabled={selectedIds.size === 0 || !canDeleteSelected} onClick={() => setIsDeleteModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 || !canDeleteSelected ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-rose-600 hover:bg-rose-50'}`}>
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
//                                 Delete
//                             </button>
//                         )}
//                         {currentView !== 'trash' && canMergeFolder && (
//                             <button disabled={selectedIds.size === 0 || !canMergeFolder} onClick={() => setIsMoveModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 || !canMergeFolder ? 'text-slate-900 cursor-not-allowed opacity-50' : 'text-[var(--brand)] hover:bg-[var(--brand-soft)]'}`}>
//                                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
//                                 Move Items
//                             </button>
//                         )}
//                         {currentView === 'trash' && (
//                             <>
//                                 <button disabled={selectedIds.size === 0} onClick={executeRecover} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-emerald-600 hover:bg-emerald-50'}`}>
//                                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
//                                     Recover
//                                 </button>
//                                 <button disabled={selectedIds.size === 0} onClick={() => setIsPermDeleteModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${selectedIds.size === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-rose-600 hover:bg-rose-50'}`}>
//                                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
//                                     Permanent Delete
//                                 </button>
//                             </>
//                         )}

//                     </div>
//                 </div>

//                 {/* ── BREADCRUMBS & LIST ── */}
//                 <div className="flex-1 flex flex-col p-6 overflow-hidden">
//                     <div className="flex items-center gap-2 mb-4 px-2">
//                         <button 
//                             onDragOver={handleDragOver}
//                             onDrop={(e) => handleDropToFolder(e, null)}
//                             onClick={() => setCurrentFolderId(null)} 
//                             className={`text-[14px] font-black ${currentFolderId === null ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>home</button>
//                         {breadcrumbPath.map(crumb => (
//                             <React.Fragment key={crumb.id}>
//                                 <span className="text-slate-300 font-black">&gt;</span>
//                                 <button 
//                                     onDragOver={handleDragOver}
//                                     onDrop={(e) => handleDropToFolder(e, crumb.id)}
//                                     onClick={() => setCurrentFolderId(crumb.id)} 
//                                     className={`text-[14px] font-black ${currentFolderId === crumb.id ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>{crumb.name}</button>
//                             </React.Fragment>
//                         ))}
//                     </div>

//                     <div className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
//                         <table className="w-full text-left border-collapse">
//                             <thead className="bg-white border-b border-slate-100">
//                                 <tr>
//                                     {selectionEnabled ? (
//                                         <th className="py-4 px-5 w-10">
//                                             <input type="checkbox" checked={selectedIds.size === filteredItems.length && filteredItems.length > 0} onChange={handleSelectAll} className="w-4 h-4 rounded border-slate-300 accent-slate-900" />
//                                         </th>
//                                     ) : null}
//                                     <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center w-16">Index</th>
//                                     <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Name</th>
//                                     {currentView !== 'trash' && (
//                                         <th className="py-4 px-2 w-8 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Star</th>
//                                     )}
//                                     {currentView !== 'trash' && (
//                                         <th className="py-4 px-3 w-16 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Q&amp;A</th>
//                                     )}
//                                     <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Version</th>
//                                     {currentView === 'trash' ? (
//                                         <>
//                                             <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Deleted By</th>
//                                             <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Deleted At</th>
//                                         </>
//                                     ) : (
//                                         <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Created At</th>
//                                     )}
//                                     <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Size</th>
//                                     {currentView !== 'trash' && (
//                                         <th className="py-4 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Permission Details</th>
//                                     )}
//                                 </tr>
//                             </thead>
//                             <tbody className="divide-y divide-slate-50">
//                                 {filteredItems.map(item => {
//                                     const isChecked = selectedIds.has(item.id);
//                                     const isFolder = item.type === 'folder';
//                                     const isDL = downloading[item.id];

//                                     return (
//                                         <tr
//                                             key={item.id}
//                                             className={`group transition-colors ${selectionEnabled ? 'cursor-pointer' : ''} ${isChecked ? 'bg-brand-soft' : 'hover:bg-brand-soft/50'}`}
//                                             onClick={selectionEnabled ? () => handleItemClick(item) : undefined}
//                                             draggable={currentView === 'files'}
//                                             onDragStart={(e) => handleDragStart(e, item)}
//                                             onDragOver={handleDragOver}
//                                             onDrop={(e) => handleDrop(e, item)}
//                                         >
//                                             {selectionEnabled ? (
//                                                 <td className="py-4 px-5" onClick={e => e.stopPropagation()}>
//                                                     <input type="checkbox" checked={isChecked} onChange={e => handleToggleSelect(item.id, e)} className="w-4 h-4 rounded border-slate-300 accent-slate-900" />
//                                                 </td>
//                                             ) : null}
//                                             <td className="py-4 px-3 text-center text-[12px] font-mono font-semibold text-slate-500">
//                                                 {item.displayIndex || '—'}
//                                             </td>
//                                             {/* <td className="py-4 px-3">
//                                                 <div className="flex items-center gap-3">
//                                                     {isFolder ? (
//                                                         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#fcd34d"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
//                                                     ) : (
//                                                         <div className="w-5 h-5 bg-slate-100 rounded text-[8px] font-black text-slate-500 flex items-center justify-center">{item.type.toUpperCase().slice(0, 3)}</div>
//                                                     )}
//                                                     <span className="text-[13px] font-semibold text-slate-800">{item.name}</span>
//                                                     {isDL && <span className="ml-2 text-[10px] text-emerald-600 font-bold animate-pulse">Downloading...</span>}
//                                                 </div>
//                                             </td> */}

//                                             <td className="py-4 px-3">
//                                                 <div className="flex items-center gap-3">
//                                                     {isFolder ? (
//                                                         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#fcd34d"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
//                                                     ) : (
//                                                         <div className="w-5 h-5 bg-slate-100 rounded text-[8px] font-black text-slate-500 flex items-center justify-center">{item.type.toUpperCase().slice(0, 3)}</div>
//                                                     )}

//                                                     {/* 🔥 THE FIX: Clickable File Name opens in New Tab! */}
//                                                     <span
//                                                         className={`text-[13px] font-semibold transition-colors ${item.type !== 'folder' && canUser('can_view', item) ? 'text-slate-800 hover:text-[var(--brand)] hover:underline cursor-pointer' : 'text-slate-800'}`}
//                                                         onClick={(e) => {
//                                                             if (item.type !== 'folder') {
//                                                                 e.stopPropagation(); // Stops the row from being selected
//                                                                 if (canUser('can_view', item)) {
//                                                                     window.open(`/view/${item.id}`, '_blank');
//                                                                 } else {
//                                                                     alert("You do not have permission to view this file.");
//                                                                 }
//                                                             }
//                                                         }}
//                                                     >
//                                                         {item.name}
//                                                     </span>

//                                                     {isDL && <span className="ml-2 text-[10px] text-emerald-600 font-bold animate-pulse">Downloading...</span>}
//                                                 </div>
//                                             </td>



//                                             {currentView !== 'trash' && (
//                                                 <td className="py-4 px-2 text-center" onClick={e => handleToggleBookmark(item, e)}>
//                                                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={bookmarkedIds.has(item.id) ? "#fbbf24" : "none"} stroke={bookmarkedIds.has(item.id) ? "#fbbf24" : "#cbd5e1"} strokeWidth="2.5" className="cursor-pointer transition-colors hover:stroke-amber-400 mx-auto">
//                                                         <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
//                                                     </svg>
//                                                 </td>
//                                             )}
//                                             {currentView !== 'trash' && (
//                                                 <td className="py-4 px-3 text-center" onClick={e => handleGoToQA(item, e)}>
//                                                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto cursor-pointer hover:stroke-[var(--brand)] transition-colors">
//                                                         <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
//                                                     </svg>
//                                                 </td>
//                                             )}
//                                             <td className="py-4 px-3 text-[12px] font-medium text-slate-500 text-center">V{item.version || 1}</td>
//                                             {currentView === 'trash' ? (
//                                                 <>
//                                                     <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.deletedBy}</td>
//                                                     <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.deletedAt}</td>
//                                                 </>
//                                             ) : (
//                                                 <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.dateCreated}</td>
//                                             )}
//                                             <td className="py-4 px-3 text-[12px] font-medium text-slate-500">{item.size}</td>
//                                             {currentView !== 'trash' && (
//                                                 <td className="py-4 px-3">
//                                                     <div className="flex items-center gap-5">
//                                                         {/* {canUser('can_view', item) ? <FaEye className="text-slate-600 text-[15px]" title="View" /> : <FaEye className="text-slate-200 text-[15px]" title="No View Access" />}
//                                                         {canUser('can_edit', item) ? <FaEdit className="text-slate-600 text-[15px]" title="Edit" /> : <FaEdit className="text-slate-200 text-[15px]" title="No Edit Access" />} */}
//                                                         {canUser('can_view', item) ? (
//                                                             <FaEye className="text-slate-600 cursor-pointer" title="View" onClick={() => {
//                                                                 setSelectedIds(new Set([item.id]));
//                                                                 setTimeout(() => executeDownloadWrapper('view'), 50);
//                                                             }} />
//                                                         ) : (
//                                                             <FaEye className="text-slate-200" title="No View Access" />
//                                                         )}

//                                                         {/* 🔥 Updated to include Word and TXT files for editing */}
//                                                         {/* 🔥 NEW UI LOGIC FOR EDIT BUTTONS */}
//                                                         {canUser('can_edit', item) && ['xlsx', 'xls', 'csv', 'docx', 'doc', 'txt'].includes(item.type) ? (
//                                                             <FaEdit
//                                                                 className="text-slate-600 cursor-pointer hover:text-[var(--brand)] transition-colors text-[16px]"
//                                                                 title="Edit Document"
//                                                                 onClick={(e) => {
//                                                                     e.stopPropagation();
//                                                                     setSelectedIds(new Set([item.id]));
//                                                                     setTimeout(() => executeDownloadWrapper('edit'), 50);
//                                                                 }}
//                                                             />
//                                                         ) : (
//                                                             <FaEdit
//                                                                 className="text-slate-200 text-[16px]"
//                                                                 title={['pdf'].includes(item.type) ? "PDFs cannot be edited" : "No Edit Access"}
//                                                             />
//                                                         )}
//                                                         {item.type === 'folder' && (canUser('can_upload', item) ? <FaUpload className="text-slate-600 text-[15px]" title="Upload" /> : <FaUpload className="text-slate-200 text-[15px]" title="No Upload Access" />)}
//                                                         {canUser('can_download_secure', item) ? <FaShieldAlt className="text-slate-600 text-[15px]" title="Download Secure" /> : <FaShieldAlt className="text-slate-200 text-[15px]" title="No Secure DL Access" />}
//                                                         {canUser('can_download_original', item) ? <FaDownload className="text-slate-600 text-[15px]" title="Download Original" /> : <FaDownload className="text-slate-200 text-[15px]" title="No Original DL Access" />}
//                                                         {canUser('can_delete', item) ? <FaTrash className="text-slate-600 text-[14px]" title="Delete" /> : <FaTrash className="text-slate-200 text-[14px]" title="No Delete Access" />}
//                                                     </div>
//                                                 </td>
//                                             )}
//                                         </tr>
//                                     );
//                                 })}
//                             </tbody>
//                         </table>
//                     </div>
//                 </div>
//             </div>

//             {isMoveModalOpen && (
//                 <Modal onClose={() => setIsMoveModalOpen(false)}>
//                     <h3 className="text-[15px] font-black mb-4">Move {selectedIds.size} items to...</h3>
//                     <div className="space-y-1 max-h-64 overflow-y-auto mb-4">
//                         <button onClick={() => setMovingToFolderId(null)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[12.5px] font-semibold ${movingToFolderId === null ? 'bg-[var(--brand)] text-white' : 'hover:bg-brand-soft text-slate-700'}`}>
//                             Root Directory
//                         </button>

//                         {/* Only show folders we can move to (not deleted, not currently selected) */}
//                         {files.filter(f => f.type === 'folder' && !deletedIds.has(f.id) && !selectedIds.has(f.id)).map(folder => (
//                             <button key={folder.id} onClick={() => setMovingToFolderId(folder.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[12.5px] font-semibold ${movingToFolderId === folder.id ? 'bg-[var(--brand)] text-white' : 'hover:bg-brand-soft text-slate-700'}`}>
//                                 <span className="truncate">{folder.name}</span>
//                             </button>
//                         ))}
//                     </div>
//                     <div className="flex gap-2">
//                         <button onClick={() => setIsMoveModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 font-bold rounded-xl text-[13px]">Cancel</button>
//                         <button onClick={executeMoveToFolder} className="flex-1 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-bold rounded-xl text-[13px]">Move Here</button>
//                     </div>
//                 </Modal>
//             )}


//             {/* Modals */}


//             {isPermDeleteModalOpen && (
//                 <Modal onClose={() => setIsPermDeleteModalOpen(false)}>
//                     <h3 className="text-[16px] font-black text-slate-900 mb-2">Permanently Delete?</h3>
//                     <p className="text-[13px] text-slate-500 mb-6">Are you sure you want to permanently delete these items? This action cannot be undone.</p>
//                     <div className="flex gap-2">
//                         <button onClick={() => setIsPermDeleteModalOpen(false)} className="flex-1 py-3 bg-slate-200 text-slate-700 cursor-pointer hover:bg-slate-300 font-bold rounded-xl text-[14px]">Cancel</button>
//                         <button onClick={executePermanentDelete} className="flex-1 py-3 bg-rose-500 text-white cursor-pointer hover:bg-rose-600 font-bold rounded-xl text-[14px]">Delete</button>
//                     </div>
//                 </Modal>
//             )}

//             {isDeleteModalOpen && (
//                 <Modal onClose={() => setIsDeleteModalOpen(false)}>
//                     <h3 className="text-[16px] font-black text-slate-900 mb-2">Send to Trash?</h3>
//                     <p className="text-[13px] text-slate-500 mb-6">These files will be moved to the Trash bin.</p>
//                     <div className="flex gap-2">
//                         <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-3 bg-slate-200 text-slate-700 cursor-pointer hover:bg-slate-300 font-bold rounded-xl text-[14px]">Cancel</button>
//                         <button onClick={executeSoftDelete} className="flex-1 py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white cursor-pointer font-bold rounded-xl text-[14px]">Send to Trash</button>
//                     </div>
//                 </Modal>
//             )}

//             {isNewFolderOpen && (
//                 <Modal onClose={() => setIsNewFolderOpen(false)}>
//                     <h3 className="text-[16px] font-black mb-4">Create New Folder</h3>
//                     <input type="text" placeholder="Folder name..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl mb-4 focus:border-[var(--brand)] focus:outline-none" />
//                     <button onClick={handleCreateFolder} className="w-full py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-bold rounded-xl">Create</button>
//                 </Modal>
//             )}

//             {isRenameModalOpen && (
//                 <Modal onClose={() => setIsRenameModalOpen(false)}>
//                     <h3 className="text-[16px] font-black text-slate-900 mb-4">Rename Item</h3>
//                     <form onSubmit={handleRename}>
//                         <input type="text" placeholder="New name..." value={renameValue} onChange={e => setRenameValue(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl mb-4 focus:border-[var(--brand)] focus:outline-none" autoFocus />
//                         <div className="flex gap-2">
//                             <button type="button" onClick={() => setIsRenameModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-300 font-bold rounded-xl text-[14px]">Cancel</button>
//                             <button type="submit" className="flex-1 py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white cursor-pointer font-bold rounded-xl text-[14px]">Rename</button>
//                         </div>
//                     </form>
//                 </Modal>
//             )}

//             {isUploadModalOpen && (
//                 <Modal onClose={() => setIsUploadModalOpen(false)}>
//                     <h3 className="text-[16px] font-black text-slate-800 mb-5">Secure Upload</h3>
//                     <div onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-3 p-10 border-2 border-dashed border-slate-200 bg-brand-soft rounded-2xl cursor-pointer hover:bg-slate-100">
//                         <span className="text-[13px] font-bold text-slate-700">Click to Browse Files</span>
//                         <span className="text-[11px] text-slate-400">Files are AES-256 Encrypted on upload</span>
//                     </div>
//                     {uploadQueue.length > 0 && (
//                         <div className="mt-4 space-y-2 max-h-48 overflow-auto">
//                             {uploadQueue.map(item => (
//                                 <div key={item.id} className="flex items-center gap-3 p-3 bg-brand-soft rounded-xl border border-slate-100">
//                                     <div className="flex-1 min-w-0">
//                                         <p className="text-[12px] font-semibold text-slate-700 truncate">{item.name}</p>
//                                     </div>
//                                     {item.status === 'completed' ? <span className="text-emerald-500 text-xs font-bold">Done</span> : <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />}
//                                 </div>
//                             ))}
//                         </div>
//                     )}
//                 </Modal>
//             )}

//         </div>
//     );
// }

// function Modal({ children, onClose, maxWidth = 'max-w-lg' }) {
//     return (
//         <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
//             <div onClick={onClose} className="absolute inset-0 bg-brand/40 backdrop-blur-[3px]" />
//             <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${maxWidth} p-6 z-10`}>
//                 {children}
//             </div>
//         </div>
//     );
// }

// // Subcomponent for Right Sidebar
// function PermRow({ label, hasAccess }) {
//     return (
//         <div className="flex items-center justify-between">
//             <span className="text-[12.5px] font-semibold text-slate-600">{label}</span>
//             {hasAccess ? (
//                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
//             ) : (
//                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
//             )}
//         </div>
//     );
// }
