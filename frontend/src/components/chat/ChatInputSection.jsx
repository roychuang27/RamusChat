import ChatInput from "../ChatInput";
import LockIcon from '@mui/icons-material/Lock';
import { formatElapsed } from "../../utils/format";

export default function ChatInputSection({
    input,
    setInput,
    handleSend,
    canSend,
    isThinking,
    thinkingElapsed
}) {
    return (
        <div className="chat-input-wrapper">
            {isThinking && (
                <div className="thinking-status">
                    <LockIcon sx={{ fontSize: 14 }} />
                    <span className="thinking-status-text">AI is running</span>
                    <span className="thinking-status-timer">{formatElapsed(thinkingElapsed)}</span>
                </div>
            )}
            <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSend}
                disabled={!canSend}
                thinking={isThinking}
            />
        </div>
    );
}
