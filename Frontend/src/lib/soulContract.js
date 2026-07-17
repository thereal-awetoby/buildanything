export const SOUL_CONTRACT_ADDRESS = import.meta.env.VITE_SOUL_CONTRACT_ADDRESS;

export const SOUL_ABI = [
  {
    type: "function",
    name: "logProgress",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_category", type: "string" },
      { name: "_xpReward", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "logLesson",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_category", type: "string" },
      { name: "_lesson", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "lessonCount",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "heartbeatCount",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalXP",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];