import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const client = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

export const handler = async (event) => {
    try {
        // 1. Parse Input Data First
        let data = event.body ? (typeof event.body === "string" ? JSON.parse(event.body) : event.body) : event;
        
        // 2. Extract and Validate Variables
        const query = data.prompt || data.query;
        const sessionId = data.sessionId || null;
        const modelArn = process.env.MODEL_ARN?.replace(/["'\s\\]/g, "");
        const defaultKnowledgeBaseId = process.env.KNOWLEDGE_BASE_ID;

        if (!modelArn || !query) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing required fields: MODEL_ARN or Query" })
            };
        }

        // Determine KB ID (use provided or default)
        const targetKbId = (data.knowledgeBaseIds && data.knowledgeBaseIds[0]) || defaultKnowledgeBaseId;

        if (!targetKbId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "No Knowledge Base ID available." })
            }
        }

        // 3. Define the Command Generator
        // Note: Using a custom prompt template requires specific placeholders ($search_results$)
        const createCommandInput = (sid) => ({
            input: { text: query },
            sessionId: sid,
            retrieveAndGenerateConfiguration: {
                type: "KNOWLEDGE_BASE",
                knowledgeBaseConfiguration: {
                    knowledgeBaseId: targetKbId,
                    modelArn: modelArn,
                    generationConfiguration: {
                        promptTemplate: {
                            textPromptTemplate: `You are a helpful Publication expert. Answer thoroughly, with clear structure.
                            - Include as many relevant details as possible.
                            - Use bullet points, headings, or numbered steps if suitable.
                            - Cite sources from the provided context.
                            
                            Context: $search_results$
                            
                            User question: $query$`
                        },
                        inferenceConfig: {
                            textInferenceConfig: {
                                temperature: 0,
                                topP: 1,
                                maxTokens: 2048,
                                stopSequences: ["\nObservation"]
                            }
                        }
                    }
                }
            }
        });

        // 4. Execution with Session Retry Logic
        let response;
        try {
            const command = new RetrieveAndGenerateCommand(createCommandInput(sessionId));
            response = await client.send(command);
        } catch (error) {
            // If sessionId is invalid, retry once without it
            if (sessionId && error.name === "ValidationException") {
                console.warn("Session invalid, retrying with fresh session...");
                const retryCommand = new RetrieveAndGenerateCommand(createCommandInput(null));
                response = await client.send(retryCommand);
            } else {
                throw error;
            }
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                generatedText: response.output.text,
                sessionId: response.sessionId,
                citations: response.citations || [],
                sourceCount: response.citations?.length || 0
            })
        };

    } catch (error) {
        console.error("Error invoking Bedrock:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.name, message: error.message })
        };
    }
};
