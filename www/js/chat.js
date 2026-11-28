// chat.js — real-time buyer ↔ seller messaging, one conversation per (listing, buyer).
import {
  db, collection, doc, getDoc, setDoc, query, where, orderBy, limitToLast, onSnapshot,
  serverTimestamp, writeBatch
} from "./firebase.js";
import { state } from "./state.js";
import {
  $, esc, safeImg, timeAgo, clockTime, toDate, toast, friendlyError, registerActions,
  openOverlay, onOverlayClose, isOverlayOpen, initials
} from "./ui.js";
import { emptyState, openDetail, getCurrentDetail } from "./listings.js";
import { avatarHtml, hydrateAvatars } from "./profiles.js";

const TS = { serverTimestamps: "estimate" };
let activeConvId = null;
let unsubThread = null;

function convFromSnap(d) { return { id: d.id, ...d.data(TS) }; }

function otherUid(c) {
  return c.buyerId === state.user?.uid ? c.sellerId : c.buyerId;
}
function otherAvatar(c, cls = "xs") {
  return `<span data-avatar-uid="${esc(otherUid(c))}" data-avatar-cls="${cls}">${avatarHtml(otherName(c), "", cls)}</span>`;
}

function otherName(c) {
  const me = state.user?.uid;
  return c.buyerId === me ? c.sellerName || "Seller" : c.buyerName || "Buyer";
}

export function isUnread(c) {
  const me = state.user?.uid;
  if (!c.lastSenderId || c.lastSenderId === me) return false;
  const read = toDate(c.lastRead?.[me]);
  const last = toDate(c.lastAt);
  return !read || (last && last > read);
}

function updateBadges() {
  const n = state.conversations.filter(isUnread).length;
  const badge = $("#msgBadge");
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? "9+" : String(n);
  $("#bellDot").hidden = n === 0;
}

function renderConversations() {
  const list = $("#conversationList");
  if (!state.conversations.length) {
    list.innerHTML = emptyState("icon-message-circle", "No messages yet", "Open any listing and tap Chat to message the seller.");
    return;
  }
  list.innerHTML = state.conversations.map((c) => {
    const unread = isUnread(c);
    const mine = c.lastSenderId === state.user.uid;
    return `
      <button class="conv ${unread ? "unread" : ""}" data-action="openConv" data-id="${esc(c.id)}">
        <span class="cv-thumb"><img src="${safeImg(c.listingThumb)}" alt="">${otherAvatar(c, "xs")}</span>
        <div class="cv-body">
          <div class="cv-top"><b>${esc(otherName(c))}</b><small>${c.lastMessage ? esc(timeAgo(c.lastAt)) : ""}</small></div>
          <div class="cv-sub">${esc(c.listingTitle)}</div>
          <div class="cv-last">${c.lastMessage ? (mine ? "You: " : "") + esc(c.lastMessage) : '<span class="muted">No messages yet</span>'}</div>
        </div>
        ${unread ? '<span class="unread-dot"></span>' : ""}
      </button>`;
  }).join("");
  hydrateAvatars(list);
}

export function subscribeConversations(uid) {
  const q = query(collection(db, "conversations"), where("participants", "array-contains", uid));
  const unsub = onSnapshot(q, (snap) => {
    state.conversations = snap.docs.map(convFromSnap)
      .sort((a, b) => (toDate(b.lastAt)?.getTime() || 0) - (toDate(a.lastAt)?.getTime() || 0));
    renderConversations();
    updateBadges();
    if (activeConvId) renderHeader(state.conversations.find((c) => c.id === activeConvId));
  }, (e) => {
    console.warn("conversations listener", e);
    $("#conversationList").innerHTML = emptyState("icon-wifi-off", "Couldn't load messages", friendlyError(e));
  });
  state.unsubscribers.push(unsub);
}

// ---------- Thread ----------
function renderHeader(c) {
  if (!c) return;
  $("#chatHeader").innerHTML = `
    <button class="icon-btn" data-action="back" aria-label="Back"><i class="icon-arrow-left"></i></button>
    <img src="${safeImg(c.listingThumb)}" alt="" data-action="openListing" data-id="${esc(c.listingId)}">
    <div class="ct-body" data-action="openListing" data-id="${esc(c.listingId)}">
      <b>${esc(otherName(c))}</b><small>${esc(c.listingTitle)}</small>
    </div>
    ${otherAvatar(c, "sm")}`;
  hydrateAvatars($("#chatHeader"));
}

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = (today - dd) / 86400000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });
}

function renderMessages(msgs) {
  const me = state.user.uid;
  let lastDay = "";
  const html = [`<div class="chat-safety"><i class="icon-shield-alert"></i> Never send money before visiting the land and verifying the title with an advocate.</div>`];
  for (const m of msgs) {
    const d = toDate(m.createdAt) || new Date();
    const day = dayLabel(d);
    if (day !== lastDay) { html.push(`<div class="day-sep">${esc(day)}</div>`); lastDay = day; }
    html.push(`<div class="msg ${m.senderId === me ? "me" : "them"} ${m.pending ? "pending" : ""}">${esc(m.text)}<time>${esc(clockTime(d))}</time></div>`);
  }
  if (!msgs.length) html.push(`<div class="empty" style="padding:30px 0"><i class="icon-hand"></i><span>Say hello and ask about the land.</span></div>`);
  const box = $("#chatMessages");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  box.innerHTML = html.join("");
  if (nearBottom || msgs.at(-1)?.senderId === me) box.scrollTop = box.scrollHeight;
}

let readTimer = null;
function markRead(convId) {
  clearTimeout(readTimer);
  readTimer = setTimeout(async () => {
    const c = state.conversations.find((x) => x.id === convId);
    if (c && !isUnread(c)) return;
    try {
      const b = writeBatch(db);
      b.update(doc(db, "conversations", convId), { [`lastRead.${state.user.uid}`]: serverTimestamp() });
      await b.commit();
    } catch (e) { console.warn("markRead", e); }
  }, 400);
}

export async function openThread(convId) {
  activeConvId = convId;
  let c = state.conversations.find((x) => x.id === convId);
  if (!c) {
    try {
      const s = await getDoc(doc(db, "conversations", convId));
      if (s.exists()) c = convFromSnap(s);
    } catch (e) { return toast(friendlyError(e), "error"); }
  }
  if (!c) return toast("Conversation not found", "error");
  renderHeader(c);
  $("#chatMessages").innerHTML = `<div class="empty"><span class="spinner dark"></span></div>`;
  $("#chatText").value = "";
  if (!isOverlayOpen("ov-chat")) openOverlay("ov-chat");

  unsubThread?.();
  const q = query(collection(db, "conversations", convId, "messages"), orderBy("createdAt"), limitToLast(300));
  unsubThread = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data(TS), pending: d.metadata.hasPendingWrites }));
    renderMessages(msgs);
    if (isOverlayOpen("ov-chat")) markRead(convId);
  }, (e) => {
    $("#chatMessages").innerHTML = emptyState("icon-wifi-off", "Couldn't load messages", friendlyError(e));
  });
  markRead(convId);
}

export async function startChat(listing) {
  if (!state.user || !listing) return;
  const me = state.user.uid;
  if (listing.sellerId === me) return toast("This is your own listing", "info");
  const convId = `${listing.id}_${me}`;
  const ref = doc(db, "conversations", convId);
  let exists = state.conversations.some((c) => c.id === convId);
  if (!exists) {
    try { exists = (await getDoc(ref)).exists(); } catch (_) { exists = false; }
  }
  if (!exists) {
    try {
      await setDoc(ref, {
        participants: [me, listing.sellerId],
        buyerId: me,
        sellerId: listing.sellerId,
        listingId: listing.id,
        listingTitle: listing.title,
        listingThumb: listing.coverThumb || "",
        buyerName: state.profile?.fullName || state.user.displayName || "Buyer",
        sellerName: listing.sellerName || "Seller",
        lastMessage: "",
        lastSenderId: "",
        lastAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        lastRead: { [me]: serverTimestamp() }
      });
    } catch (e) {
      return toast(friendlyError(e), "error");
    }
  }
  openThread(convId);
}

async function send(text) {
  const convId = activeConvId;
  if (!convId) return;
  const me = state.user.uid;
  const convRef = doc(db, "conversations", convId);
  const msgRef = doc(collection(convRef, "messages"));
  const b = writeBatch(db);
  b.set(msgRef, { senderId: me, text, createdAt: serverTimestamp() });
  b.update(convRef, {
    lastMessage: text.slice(0, 200),
    lastSenderId: me,
    lastAt: serverTimestamp(),
    [`lastRead.${me}`]: serverTimestamp()
  });
  await b.commit();
}

export function initChat() {
  const input = $("#chatText");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  $("#chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (text.length > 2000) return toast("Message is too long", "error");
    input.value = "";
    input.style.height = "auto";
    try { await send(text); }
    catch (err) { input.value = text; toast(friendlyError(err), "error"); }
  });

  onOverlayClose("ov-chat", () => {
    unsubThread?.();
    unsubThread = null;
    activeConvId = null;
  });

  registerActions({
    openConv: (el) => openThread(el.dataset.id),
    chatSeller: () => startChat(getCurrentDetail())
  });
}

export function stopChat() {
  unsubThread?.();
  unsubThread = null;
  activeConvId = null;
}

export { openDetail };
