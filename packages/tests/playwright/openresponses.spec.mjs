import { expect, test } from "@playwright/test";

test("legacy house conversation state is translated to canonical OpenResponses", async ({ page }) => {
  let requestBody;
  await page.route("http://127.0.0.1:59999/v1/responses", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "resp_test",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Ready." }],
          },
          {
            type: "function_call",
            id: "fc_test",
            call_id: "call_test",
            name: "set_mood",
            arguments: '{"mood":"focused"}',
            status: "completed",
          },
        ],
      }),
    });
  });

  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { requestOpenResponsesTurn } = await import("/src/runtime/openresponses-client.ts");
    return requestOpenResponsesTurn({
      baseUrl: "http://127.0.0.1:59999",
      model: "text/test",
      messages: [
        { role: "system", content: "Stay concise." },
        { role: "user", content: "Hello" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "set_mood",
            description: "Set the avatar mood.",
            parameters: { type: "object", properties: { mood: { type: "string" } } },
          },
        },
      ],
    });
  });

  expect(requestBody.instructions).toBe("Stay concise.");
  expect(requestBody.input).toEqual([{ role: "user", content: "Hello" }]);
  expect(requestBody.tools[0].name).toBe("set_mood");
  expect(result.choices[0].message.content).toBe("Ready.");
  expect(result.choices[0].message.tool_calls[0].function.name).toBe("set_mood");
});
