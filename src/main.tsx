import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { PostPage } from "./pages/Post";
import { PostDetailPage } from "./pages/PostDetail";
import { BrowsePage } from "./pages/Browse";
import { SearchPage } from "./pages/Search";
import { ClaimPage } from "./pages/Claim";
import { AgentPage } from "./pages/Agent";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/new" element={<BrowsePage />} />
          <Route path="/post" element={<PostPage />} />
          <Route path="/post/:id" element={<PostDetailPage />} />
          <Route path="/browse/:category" element={<BrowsePage />} />
          <Route path="/browse/:category/:subcategory" element={<BrowsePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/claim/:token" element={<ClaimPage />} />
          <Route path="/agent/:name" element={<AgentPage />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>
);
