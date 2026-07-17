import { useEffect, useState, useCallback } from "react";
import { usePublicClient, useAccount, useWatchContractEvent } from "wagmi";
import { CONTRACT_ADDRESS, HEARTBEAT_ABI } from "../lib/contract";

export function useHeartbeats() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [heartbeats, setHeartbeats] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!isConnected || !address || !CONTRACT_ADDRESS) {
      setHeartbeats([]);
      return;
    }
    setIsLoading(true);
    try {
      const logs = await publicClient.getContractEvents({
        address: CONTRACT_ADDRESS,
        abi: HEARTBEAT_ABI,
        eventName: "HeartbeatLogged",
        args: { builder: address },
        fromBlock: "earliest",
        toBlock: "latest",
      });
      setHeartbeats(
        logs
          .map((log) => ({
            category: log.args.category,
            summary: log.args.summary,
            xpReward: Number(log.args.xpReward),
            timestamp: Number(log.args.timestamp) * 1000,
          }))
          .sort((a, b) => b.timestamp - a.timestamp)
      );
    } catch (err) {
      console.error("Failed to load heartbeats:", err);
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, publicClient]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useWatchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: HEARTBEAT_ABI,
    eventName: "HeartbeatLogged",
    enabled: Boolean(CONTRACT_ADDRESS && isConnected),
    onLogs(logs) {
      logs.forEach((log) => {
        if (log.args.builder?.toLowerCase() !== address?.toLowerCase()) return;
        setHeartbeats((prev) => [
          {
            category: log.args.category,
            summary: log.args.summary,
            xpReward: Number(log.args.xpReward),
            timestamp: Number(log.args.timestamp) * 1000,
          },
          ...prev,
        ]);
      });
    },
  });

  return { heartbeats, isLoading, streak: computeStreak(heartbeats), refresh: loadHistory };
}

function computeStreak(heartbeats) {
  if (heartbeats.length === 0) return 0;
  const days = new Set(heartbeats.map((h) => new Date(h.timestamp).toDateString()));
  let streak = 0;
  let cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}