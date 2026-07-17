import { useEffect, useState, useCallback } from "react";
import { usePublicClient, useAccount, useWatchContractEvent } from "wagmi";
import { CONTRACT_ADDRESS, HEARTBEAT_ABI } from "../lib/contract";

// This RPC enforces a hard 100-block range per eth_getLogs call, so results
// must be paginated. MAX_CHUNKS caps total lookback to keep page load fast
// and avoid hammering the public endpoint — recent heartbeats always show;
// anything older than this window won't, until the live watcher below sees it.
const CHUNK_SIZE = 100n;
const MAX_CHUNKS = 20;
const DEPLOY_BLOCK = import.meta.env.VITE_CONTRACT_DEPLOY_BLOCK
  ? BigInt(import.meta.env.VITE_CONTRACT_DEPLOY_BLOCK)
  : null;

async function fetchLogsPaginated(publicClient, baseParams, fromBlock, toBlock) {
  const allLogs = [];
  let chunkStart = fromBlock;
  let chunksUsed = 0;
  while (chunkStart <= toBlock && chunksUsed < MAX_CHUNKS) {
    const chunkEnd = chunkStart + CHUNK_SIZE - 1n > toBlock ? toBlock : chunkStart + CHUNK_SIZE - 1n;
    try {
      const logs = await publicClient.getContractEvents({
        ...baseParams,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      });
      allLogs.push(...logs);
    } catch (err) {
      console.error(`Failed to fetch logs for blocks ${chunkStart}-${chunkEnd}:`, err);
    }
    chunkStart = chunkEnd + 1n;
    chunksUsed++;
  }
  return allLogs;
}

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
      const currentBlock = await publicClient.getBlockNumber();
      const maxLookback = BigInt(MAX_CHUNKS) * CHUNK_SIZE;
      let fromBlock = currentBlock > maxLookback ? currentBlock - maxLookback : 0n;
      if (DEPLOY_BLOCK !== null && DEPLOY_BLOCK > fromBlock) {
        fromBlock = DEPLOY_BLOCK;
      }

      const logs = await fetchLogsPaginated(
        publicClient,
        {
          address: CONTRACT_ADDRESS,
          abi: HEARTBEAT_ABI,
          eventName: "HeartbeatLogged",
          args: { builder: address },
        },
        fromBlock,
        currentBlock
      );

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