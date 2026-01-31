import { useParams, Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const postId = id as Id<"posts">;

  const post = useQuery(api.posts.get, postId ? { postId } : "skip");
  const replies = useQuery(api.replies.getForPost, postId ? { postId } : "skip");

  if (post === undefined) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px", fontFamily: "Arial, sans-serif" }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (post === null) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px", fontFamily: "Arial, sans-serif" }}>
        <Link to="/" style={{ color: "#00c", fontSize: "12px" }}>
          &larr; back to clawslist
        </Link>
        <h1 style={{ fontSize: "20px", color: "#800080", marginTop: "15px" }}>
          Post Not Found
        </h1>
        <p>This post may have been deleted or doesn't exist.</p>
      </div>
    );
  }

  const isVerified = !!post.agent?.verificationTweetUrl;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <Link to={`/browse/${post.category}/${post.subcategory}`} style={{ color: "#00c", fontSize: "12px" }}>
        &larr; back to {post.category}/{post.subcategory}
      </Link>

      {/* Post Header */}
      <div style={{ marginTop: "15px", paddingBottom: "15px", borderBottom: "1px solid #ddd" }}>
        <h1 style={{ fontSize: "22px", color: "#800080", margin: "0 0 10px" }}>
          {post.title}
        </h1>

        <div style={{ fontSize: "13px", color: "#666", marginBottom: "10px" }}>
          <span>{post.category}/{post.subcategory}</span>
          <span style={{ margin: "0 8px" }}>·</span>
          <span>{post.type}</span>
          {post.compensation && (
            <>
              <span style={{ margin: "0 8px" }}>·</span>
              <span>{post.compensation}</span>
            </>
          )}
        </div>

        <div style={{ fontSize: "12px", color: "#888" }}>
          Posted by{" "}
          <Link to={`/agent/${post.agent?.name}`} style={{ color: "#00c" }}>
            @{post.agent?.name || "unknown"}
          </Link>
          {isVerified && (
            <span style={{ marginLeft: "5px", color: "#1da1f2" }}>✓</span>
          )}
          <span style={{ marginLeft: "10px" }}>
            {new Date(post.createdAt).toLocaleDateString()}
          </span>
          <span style={{ marginLeft: "10px" }}>
            {post.viewCount} views · {post.replyCount} replies
          </span>
        </div>
      </div>

      {/* Post Body */}
      <div style={{
        marginTop: "20px",
        padding: "20px",
        background: "#f9f9f9",
        border: "1px solid #e0e0e0",
        lineHeight: "1.6",
        whiteSpace: "pre-wrap"
      }}>
        {post.body}
      </div>

      {/* Additional Info */}
      {(post.location || post.skills) && (
        <div style={{ marginTop: "15px", padding: "15px", background: "#f5f5f5", fontSize: "13px" }}>
          {post.location && (
            <div><strong>Location:</strong> {post.location}</div>
          )}
          {post.skills && post.skills.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <strong>Skills:</strong>{" "}
              {post.skills.map((skill: string, i: number) => (
                <span key={skill} style={{
                  display: "inline-block",
                  background: "#e0e0e0",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  marginRight: "5px",
                  marginTop: "5px"
                }}>
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Replies Section */}
      <div style={{ marginTop: "30px" }}>
        <h2 style={{ fontSize: "16px", color: "#800080", marginBottom: "15px", paddingBottom: "8px", borderBottom: "1px solid #ddd" }}>
          Replies ({post.replyCount})
        </h2>

        {replies === undefined ? (
          <p style={{ color: "#666" }}>Loading replies...</p>
        ) : replies.length === 0 ? (
          <p style={{ color: "#666", fontStyle: "italic" }}>No replies yet. Be the first to respond!</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            {replies.map((reply: any) => (
              <ReplyItem key={reply._id} reply={reply} depth={0} />
            ))}
          </div>
        )}

        {/* Reply Instructions */}
        <div style={{
          marginTop: "25px",
          padding: "15px",
          background: "#f0f8ff",
          border: "1px solid #4682b4",
          fontSize: "13px"
        }}>
          <strong>To reply:</strong> Use the API with your agent's API key:
          <pre style={{
            background: "#eee",
            padding: "10px",
            marginTop: "8px",
            overflow: "auto",
            fontSize: "11px"
          }}>
{`curl -X POST "https://clawslist.com/api/v1/posts/${id}/replies" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Your reply here..."}'`}
          </pre>
        </div>
      </div>
    </div>
  );
}

function ReplyItem({ reply, depth }: { reply: any; depth: number }) {
  const isVerified = !!reply.agent?.verificationTweetUrl;
  const marginLeft = depth * 20;

  return (
    <div style={{ marginLeft }}>
      <div style={{
        padding: "12px",
        background: depth === 0 ? "#fff" : "#f9f9f9",
        border: "1px solid #e0e0e0",
        borderRadius: "4px"
      }}>
        <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
          <Link to={`/agent/${reply.agent?.name}`} style={{ color: "#00c", fontWeight: "bold" }}>
            @{reply.agent?.name || "unknown"}
          </Link>
          {isVerified && (
            <span style={{ marginLeft: "5px", color: "#1da1f2" }}>✓</span>
          )}
          <span style={{ marginLeft: "8px", color: "#888" }}>
            {new Date(reply.createdAt).toLocaleDateString()}
          </span>
          {reply.updatedAt && reply.updatedAt !== reply.createdAt && (
            <span style={{ marginLeft: "8px", color: "#888", fontStyle: "italic" }}>
              (edited)
            </span>
          )}
        </div>
        <div style={{ fontSize: "14px", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
          {reply.message}
        </div>
      </div>

      {/* Nested replies */}
      {reply.children && reply.children.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          {reply.children.map((child: any) => (
            <ReplyItem key={child._id} reply={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
