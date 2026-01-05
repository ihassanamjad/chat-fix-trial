/**
 * ChatScreenTrial.js
 *
 * Candidate task:
 * - Improve correctness and reliability of sending/retrying messages
 * - Improve performance and reduce unnecessary re-renders / jank
 * - Keep changes minimal (no full rewrite required)
 *
 * Deliverables:
 * 1) Updated code (PR / patch / zip)
 * 2) 3–5 minute screen recording: what you changed, why, and how you verified it
 */


import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * @typedef {"sending"|"sent"|"failed"} MessageStatus
 * @typedef {{
 *   id: string,
 *   clientId: string,
 *   text: string,
 *   sender: "me"|"them",
 *   timestamp: number,
 *   status: MessageStatus
 * }} Message
 */

const STORAGE_KEY = "trial_chat_messages_v1";

function makeId(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

const initialMessages = Array.from({ length: 20 }).map((_, i) => ({
  id: i.toString(),
  clientId: `seed_${i}`,
  text: `Seed message ${i}`,
  sender: i % 2 === 0 ? "me" : "them",
  timestamp: Date.now() - i * 1000 * 45,
  status: "sent",
}));

function createMockSend() {
  const offlineRef = { current: false };

  const setOffline = (v) => {
    offlineRef.current = v;
  };

  const send = (payload) => {
    const jitterMs = 200 + Math.floor(Math.random() * 900);

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (offlineRef.current) {
          reject(new Error("OFFLINE"));
          return;
        }

        if (Math.random() < 0.3) {
          reject(new Error("SERVER_ERROR"));
          return;
        }

        resolve({
          serverId: makeId("srv"),
          serverTimestamp: Date.now(),
        });
      }, jitterMs);
    });
  };

  return { send, setOffline };
}

const mock = createMockSend();

export default function ChatScreenTrial() {
  const [messages, setMessages] = useState(/** @type {Message[]} */ (initialMessages));
  const [inputText, setInputText] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [stats, setStats] = useState({ renders: 0, sends: 0, fails: 0 });

  const appStateRef = useRef(AppState.currentState);

  /**
   * Problem: Directly mutating state object instead of using setState.
   * Solution: Rendered counter (use ref to avoid triggering re-renders)
   */
  // render counter
  const renderCountRef = useRef(0);
  renderCountRef.current++;

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mounted) return;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setMessages(parsed);
        } catch {
          // ignore
        }
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Problem: Saving to AsyncStorage on every keystroke is wasteful.
   * Solution: Removed inputText from dependncies and only saved after initial hydration to avoid race condition.
   */
  
  useEffect(() => {
    if (hydrated) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
    }
  }, [messages, hydrated]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
    });
    return () => sub.remove();
  }, [messages]);

  useEffect(() => {
    mock.setOffline(isOffline);
  }, [isOffline]);

  const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);

  /**
   * Problem: When a message sends successfully, it's adding BOTH the old optimistic message AND the new acked message, creating duplicates.
   * Solution: Used functional update to get the current messages array, found the optimistic message and replaced it with the acked one.
   */
  const sendMessage = () => {
    if (!inputText.trim()) return;

    const clientId = makeId("cli");
    /** @type {Message} */
    const optimistic = {
      id: makeId("tmp"),
      clientId,
      text: inputText,
      sender: "me",
      timestamp: Date.now(),
      status: "sending",
    };

    setMessages((prevMessages) => [...prevMessages, optimistic]);

    setStats((prevStats) => ({ ...prevStats, sends: prevStats.sends + 1 }));
    setInputText("");

    mock
      .send({ clientId, text: optimistic.text })
      .then(({ serverId, serverTimestamp }) => {
        const acked = {
          ...optimistic,
          id: serverId,
          timestamp: serverTimestamp,
          status: "sent",
        };
        setMessages((prevMessages) =>
          prevMessages.map((msg) => (msg.clientId === clientId ? acked : msg))
        );
      })
      .catch((err) => {
        const failed = {
          ...optimistic,
          status: "failed",
          text: `${optimistic.text} (${String(err.message || err)})`,
        };
        setMessages((prevMessages) =>
          prevMessages.map((msg) => (msg.clientId === clientId ? failed : msg))
        );
        setStats((prevStats) => ({ ...prevStats, fails: prevStats.fails + 1 }));
      });
  };

  /**
   * Problem: setInputText doesn't update immediately, so sendMessage() reads the old value.
   * Solution: Used a local variable to get the clean text and set it to the new value.
   */
  const retryMessage = (msg) => {
    if (msg.status !== "failed") return;
    const cleanText = msg.text.replace(/\s*\(.*\)\s*$/, "");
    setInputText(cleanText);
  };

  const spamSend = (n = 10) => {
    for (let i = 0; i < n; i++) {
      setInputText(`Spam ${i + 1} @ ${new Date().toLocaleTimeString()}`);
      sendMessage();
    }
  };

  const renderItem = ({ item, index }) => {
    console.log("Rendering row index:", index);

    const bubbleStyle = {
      alignSelf: item.sender === "me" ? "flex-end" : "flex-start",
      backgroundColor: item.sender === "me" ? "#007AFF" : "#E5E5EA",
    };

    const textStyle = {
      color: item.sender === "me" ? "white" : "black",
    };

    return (
      <Pressable
        onPress={() => retryMessage(item)}
        style={[styles.bubble, bubbleStyle, item.status === "failed" ? styles.failed : null]}
      >
        <Text style={[styles.bubbleText, textStyle]}>{item.text}</Text>
        <Text style={styles.meta}>
          {new Date(item.timestamp).toLocaleTimeString()} • {item.status}
        </Text>
        {item.status === "failed" ? <Text style={styles.tap}>Tap to retry</Text> : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chat Trial Screen</Text>
        <View style={styles.headerRow}>
          <Button
            title={isOffline ? "Offline: ON" : "Offline: OFF"}
            onPress={() => setIsOffline((v) => !v)}
          />
          <View style={{ width: 10 }} />
          <Button title="Spam 10" onPress={() => spamSend(10)} />
        </View>
        <Text style={styles.sub}>
          {hydrated ? "Hydrated" : "Hydrating..."} • renders: {stats.renders} • sends:{" "}
          {stats.sends} • fails: {stats.fails}
        </Text>
      </View>

      <FlatList
        data={sortedMessages}
        renderItem={renderItem}
        keyExtractor={(item, index) => index.toString()}
        contentContainerStyle={styles.listContent}
      />

      <View style={styles.composer}>
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message…"
          style={styles.input}
          autoCorrect={false}
        />
        <Button title="Send" onPress={sendMessage} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 54, backgroundColor: "#fff" },
  header: { paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: "#eee" },
  title: { fontSize: 18, fontWeight: "700" },
  headerRow: { flexDirection: "row", marginTop: 8, alignItems: "center" },
  sub: { marginTop: 8, color: "#666" },
  listContent: { padding: 12, paddingBottom: 24 },
  bubble: {
    padding: 10,
    marginVertical: 6,
    borderRadius: 12,
    maxWidth: "85%",
  },
  bubbleText: { fontSize: 16 },
  meta: { marginTop: 4, fontSize: 12, color: "rgba(0,0,0,0.6)" },
  tap: { marginTop: 4, fontSize: 12, fontWeight: "600" },
  failed: { borderWidth: 2, borderColor: "#ff3b30" },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderColor: "#eee",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 44,
  },
});
