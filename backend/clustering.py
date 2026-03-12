import numpy as np

from ai import generate_reply, get_embeddings_batch
from memory import _is_memory, _slice_title
from session import load_sessions, save_sessions, load_messages, save_messages

# Parameters
FOREST_THRESHOLD = 0.4
TREE_EPS = 0.3
EPS_DECAY = 0.65
MIN_EPS = 0.15
MIN_SAMPLES = 2
MAX_TRANSCRIPT_CHARS = 2000


def _cosine_distance_matrix(embs):
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-10)
    nrm = embs / norms
    sim = nrm @ nrm.T
    np.clip(sim, -1.0, 1.0, out=sim)
    return 1.0 - sim


def _forest_partition(dist, threshold):
    n = dist.shape[0]
    groups = [[i] for i in range(n)]
    while True:
        best_pair = None
        best_dist = threshold
        m = len(groups)
        if m <= 1:
            break
        for a in range(m):
            for b in range(a + 1, m):
                ga, gb = groups[a], groups[b]
                max_d = dist[np.ix_(ga, gb)].max()
                if max_d < best_dist:
                    best_dist = max_d
                    best_pair = (a, b)
        if best_pair is None:
            break
        a, b = best_pair
        groups[a].extend(groups[b])
        groups.pop(b)
    return groups


def _dbscan(dist_sub, eps, min_samples):
    n = dist_sub.shape[0]
    labels = np.full(n, -1, dtype=int)
    neighs = [np.where(dist_sub[i] <= eps)[0] for i in range(n)]
    core = {i for i, nb in enumerate(neighs) if nb.size >= min_samples}
    cid = 0
    visited = set()
    for i in range(n):
        if i in visited or i not in core:
            continue
        stack = [i]
        visited.add(i)
        while stack:
            p = stack.pop()
            labels[p] = cid
            if p in core:
                for q in neighs[p]:
                    if q not in visited:
                        visited.add(q)
                        stack.append(q)
        cid += 1
    # assign border points
    for i in range(n):
        if labels[i] != -1:
            continue
        for q in neighs[i]:
            if labels[q] != -1:
                labels[i] = labels[q]
                break
    return labels


def _find_hub(indices, embs):
    subset = embs[np.array(indices)]
    centroid = subset.mean(axis=0)
    dists = np.linalg.norm(subset - centroid, axis=1)
    return indices[int(np.argmin(dists))]


def _nested_dbscan(indices, embs, dist, eps, min_samples, decay, min_eps):
    if len(indices) < min_samples:
        return []
    idx_arr = np.array(indices)
    subd = dist[np.ix_(idx_arr, idx_arr)]
    labels = _dbscan(subd, eps, min_samples)
    clusters = {}
    for i, lab in enumerate(labels):
        if lab != -1:
            clusters.setdefault(lab, []).append(indices[i])
    if not clusters:
        return []
    edges = []
    next_eps = eps * decay
    for members in clusters.values():
        hub = _find_hub(members, embs)
        others = [m for m in members if m != hub]
        if not others:
            continue
        if next_eps >= min_eps and len(others) >= min_samples:
            sub = _nested_dbscan(others, embs, dist, next_eps, min_samples, decay, min_eps)
            edges.extend(sub)
            children_in_sub = {c for _, c in sub}
            for m in others:
                if m not in children_in_sub:
                    edges.append((hub, m))
        else:
            for m in others:
                edges.append((hub, m))
    return edges


def _build_tree(group, embs, dist):
    if len(group) < 2:
        return []
    hub = _find_hub(group, embs)
    others = [m for m in group if m != hub]
    if len(others) < MIN_SAMPLES:
        return [(hub, m) for m in others]
    sub_edges = _nested_dbscan(others, embs, dist, TREE_EPS, MIN_SAMPLES, EPS_DECAY, MIN_EPS)
    children_in_sub = {c for _, c in sub_edges}
    edges = list(sub_edges)
    for m in others:
        if m not in children_in_sub:
            edges.append((hub, m))
    return edges


def _build_transcript(msgs):
    parts = []
    for msg in msgs:
        role = "User" if msg.get("sender") == "me" else "AI"
        text = _slice_title(msg.get("text", ""), max_len=150)
        parts.append(f"{role}: {text}")
    t = "\n".join(parts)
    if len(t) > MAX_TRANSCRIPT_CHARS:
        t = t[:MAX_TRANSCRIPT_CHARS] + "\n...(truncated)"
    return t


def _summarize_sessions(sessions_with_msgs):
    summaries = []
    for s, msgs in sessions_with_msgs:
        if not msgs:
            summaries.append(s.get("title", "empty session"))
            continue
        transcript = _build_transcript(msgs)
        prompt = (
            "Summarize the following conversation in 1-2 concise sentences. "
            "Focus on the main topic and key points discussed.\n\n"
            f"{transcript}\n\nSummary:"
        )
        try:
            summaries.append(generate_reply(prompt))
        except Exception:
            summaries.append(s.get("title", "empty session"))
    return summaries


def _sort_session_messages(session_id):
    msgs = load_messages(session_id)
    if len(msgs) <= 1:
        return
    msgs.sort(key=lambda m: (m.get("timestamp", ""), m.get("id", 0)))
    save_messages(session_id, msgs)


def reparent_sessions():
    sessions = load_sessions()
    if len(sessions) < 2:
        return {"clusters": [], "message": "Need at least 2 sessions to reorganize"}

    sessions_with_msgs = []
    for s in sessions:
        msgs = load_messages(s["id"])
        mem = [m for m in msgs if _is_memory(m)]
        sessions_with_msgs.append((s, mem))

    summaries = _summarize_sessions(sessions_with_msgs)
    emb_batch = get_embeddings_batch(summaries)
    embs = np.array([np.array(e) for e in emb_batch])

    dist = _cosine_distance_matrix(embs)
    groups = _forest_partition(dist, FOREST_THRESHOLD)

    all_edges = []
    for g in groups:
        all_edges.extend(_build_tree(g, embs, dist))

    parent_map = {child: parent for parent, child in all_edges}

    # apply parent ids to original session objects
    session_map = {s["id"]: s for s in sessions}
    for s in sessions:
        s["parent_id"] = None
    for child_idx, parent_idx in parent_map.items():
        child_id = sessions[child_idx]["id"]
        parent_id = sessions[parent_idx]["id"]
        if child_id in session_map:
            session_map[child_id]["parent_id"] = parent_id

    save_sessions(sessions)

    for s in sessions:
        _sort_session_messages(s["id"])

    clusters_result = []
    children_by_parent = {}
    for sid, s in session_map.items():
        pid = s.get("parent_id")
        if pid is not None:
            children_by_parent.setdefault(pid, []).append(sid)
    for pid, cids in children_by_parent.items():
        clusters_result.append({"parent_id": pid, "child_ids": cids})

    return {"clusters": clusters_result}