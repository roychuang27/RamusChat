import { useState, useCallback } from "react";
import * as api from "../api";

export function useSnapshotManager(addToast, fetchSessions, loadSessionData) {
    const [snapshots, setSnapshots] = useState([]);
    const [showVersionControl, setShowVersionControl] = useState(false);

    const refreshSnapshots = useCallback(async () => {
        try {
            setSnapshots(await api.fetchSnapshots());
        } catch (err) {
            console.error("Failed to fetch snapshots:", err);
            addToast("Failed to load snapshots");
        }
    }, [addToast]);

    const handleRollback = async (snapshotId, currentSessionId) => {
        try {
            await api.rollbackToSnapshot(snapshotId);
            await fetchSessions();
            if (currentSessionId) await loadSessionData(currentSessionId);
            await refreshSnapshots();
        } catch (err) {
            console.error("Failed to rollback:", err);
            addToast(`Rollback failed: ${err.message}`);
        }
    };

    const handleDeleteSnapshot = async (snapshotId) => {
        try {
            await api.deleteSnapshot(snapshotId);
            setSnapshots(prev => prev.filter(s => s.id !== snapshotId));
        } catch (err) {
            console.error("Failed to delete snapshot:", err);
            addToast("Failed to delete snapshot");
        }
    };

    return {
        snapshots,
        showVersionControl,
        setShowVersionControl,
        refreshSnapshots,
        handleRollback,
        handleDeleteSnapshot
    };
}
