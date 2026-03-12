import Message from "../../Message";
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

export default function MessageList({
    messages,
    loading,
    currentSession,
    isThinking,
    chatMessagesRef,
    onScroll,
    showScrollBtn,
    scrollToBottom
}) {
    return (
        <div className="chat-messages-wrapper">
            <div className="chat-messages" ref={chatMessagesRef} onScroll={onScroll}>
                {!currentSession ? (
                    <div className="loading-text">Select a chat from the tree view</div>
                ) : loading ? (
                    <div className="loading-text">Loading...</div>
                ) : messages.length === 0 ? (
                    <div className="loading-text">No messages yet</div>
                ) : (
                    messages.map((msg) => (
                        <Message key={msg.id} message={msg} />
                    ))
                )}
                {isThinking && (
                    <div className="chat-thinking">
                        <div className="chat-thinking-label">
                            <span>Generating response</span>
                            <span className="chat-thinking-dots">
                                <span /><span /><span />
                            </span>
                        </div>
                    </div>
                )}
            </div>
            {showScrollBtn && (
                <button className="scroll-bottom-btn" onClick={scrollToBottom}>
                    <ArrowDownwardIcon sx={{ fontSize: 20 }} />
                </button>
            )}
        </div>
    );
}
