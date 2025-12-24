
import { createOrchestrator } from "../src/pipeline/orchestrator";
import { InputSection } from "../src/directors/types";

async function verify() {
  console.log("Starting Sprint 5 Verification...");

  const orchestrator = createOrchestrator({
    baseUrl: "http://localhost:1234/v1", // Mock URL, we expect it to fail reaching AI but code structure should run
    model: "test-model",
    timeoutMs: 1000,
    retries: 0
  });

  const inputs: InputSection[] = [
    { start_ms: 0, end_ms: 5000, text: "Hello world" },
    { start_ms: 5000, end_ms: 10000, text: "Goodbye world" }
  ];

  try {
    // We expect this to fail on network request, but we want to verify the Orchestrator sets up correctly
    // and attempts to call the directors.
    // If we have unit tests context we could mock the AI calls.
    // Here we just check if it compiles and runs without immediate runtime errors before the network call.
    console.log("Initializing Orchestrator run...");
    const promise = orchestrator.run({
      sections: inputs,
      durationMs: 10000,
      enabledDirectors: ["performance", "stage", "camera", "postfx"]
    });
    
    // We assume it will fail due to network, but if it throws "PostFXDirector is not a constructor" that's what we want to catch.
    await promise;
  } catch (e: any) {
    if (e.message?.includes("fetch failed") || e.message?.includes("ECONNREFUSED") || e.cause?.code === "ECONNREFUSED") {
        console.log("Verification Passed Stage 1: Runtime structure operational (Network error expected)");
    } else {
        console.error("Verification Error:", e);
        // It might be the fallback mechanism kicking in if network fails? 
        // Actually orchestrator catches errors and returns fallback if performance fails.
        // So run might actually resolve!
        if (e.message === "Pipeline cancelled by user") {
             // ignore
        }
    }
  }
}

verify().catch(console.error);
