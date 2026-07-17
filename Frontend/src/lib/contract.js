export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

export const HEARTBEAT_ABI = [
  {
    type: "function",
    name: "logHeartbeat",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_category", type: "string" },
      { name: "_summary", type: "string" },
      { name: "_xpReward", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getStats",
    stateMutability: "view",
    inputs: [{ name: "_builder", type: "address" }],
    outputs: [
      { name: "count", type: "uint256" },
      { name: "xp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "HeartbeatLogged",
    anonymous: false,
    inputs: [
      { name: "builder", type: "address", indexed: true },
      { name: "category", type: "string", indexed: false },
      { name: "summary", type: "string", indexed: false },
      { name: "xpReward", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
];