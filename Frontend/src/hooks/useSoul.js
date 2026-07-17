import { useEffect, useState, useCallback } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { SOUL_CONTRACT_ADDRESS, SOUL_ABI } from "../lib/soulContract";

export function useSoul() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [soul, setSoul] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isConnected || !address || !SOUL_CONTRACT_ADDRESS) {
      setSoul(null);
      return;
    }
    setIsLoading(true);
    try {
      const tokenId = await publicClient.readContract({
        address: SOUL_CONTRACT_ADDRESS,
        abi: SOUL_ABI,
        functionName: "tokenOf",
        args: [address],
      });

      if (!tokenId || tokenId === 0n) {
        setSoul(null);
        return;
      }

      const uri = await publicClient.readContract({
        address: SOUL_CONTRACT_ADDRESS,
        abi: SOUL_ABI,
        functionName: "tokenURI",
        args: [tokenId],
      });

      const jsonB64 = uri.replace("data:application/json;base64,", "");
      const json = JSON.parse(atob(jsonB64));

      setSoul({
        tokenId: tokenId.toString(),
        name: json.name,
        imageDataUri: json.image,
        attributes: json.attributes || [],
      });
    } catch (err) {
      console.error("Failed to load Soul NFT:", err);
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected, publicClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { soul, isLoading, refresh };
}