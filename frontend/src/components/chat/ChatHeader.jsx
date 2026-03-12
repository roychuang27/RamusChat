import EditIcon from '@mui/icons-material/Edit';

export default function ChatHeader({ title, onEdit, disabled }) {
    return (
        <div className="chat-header">
            <div className="chat-header-content">
                <span className="chat-header-title">{title}</span>
                <button
                    className="edit-title-btn"
                    onClick={onEdit}
                    disabled={disabled}
                    title="Edit title"
                >
                    <EditIcon sx={{ fontSize: 16 }} />
                </button>
            </div>
        </div>
    );
}
