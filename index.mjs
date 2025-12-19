import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const client = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

export const handler = async (event) => {
    try {
        // 1. Verify Environment Variables
        const defaultKnowledgeBaseId = process.env.KNOWLEDGE_BASE_ID;
        const modelArn = process.env.MODEL_ARN?.replace(/["'\s\\]/g, "");


        if (!modelArn) {
            console.error("Missing Environment Variable: MODEL_ARN");
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: "Configuration Error",
                    message: "Lambda environment variable MODEL_ARN is not set."
                })
            };
        }

        // Handle event body
        let data;
        const query = data.prompt || data.query;
        const fullPrompt = `You are a helpful Publication expert. Answer thoroughly, with clear structure.
                            - Include as many relevant details as possible.
                            - Use bullet points, headings, or numbered steps if suitable.
                            - If you use knowledge base sources, cite them inline.
                            Context so far:                            
                            User question: ${query}`
        if (event.body) {
            data = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } else {
            data = event;
        }

        
        let sessionId = data.sessionId;
        
        const kbIds = data.knowledgeBaseIds && Array.isArray(data.knowledgeBaseIds) 
            ? data.knowledgeBaseIds 
            : [defaultKnowledgeBaseId].filter(Boolean);

        if (!query) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Query or prompt is required" })
            };
        }

        if (kbIds.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "No Knowledge Base ID provided" })
            };
        }

        const targetKbId = kbIds[0];

        // Shared inference configuration from your AWS Console snippet
        const inferenceConfig = {
            textInferenceConfig: {
                temperature: 0,
                topP: 1,
                maxTokens: 2048,
                stopSequences: ["\nObservation"]
            }
        };

        // Helper function to create the command input matching your AWS Console config
        const createCommandInput = (sid) => ({
            input: { text: fullPrompt },
            retrieveAndGenerateConfiguration: {
                knowledgeBaseConfiguration: {
                    knowledgeBaseId: targetKbId,
                    modelArn: modelArn, 
                },
                type: "KNOWLEDGE_BASE"
            }
        });

        let response;
        try {
            const command = new RetrieveAndGenerateCommand(createCommandInput(sessionId));
            response = await client.send(command);
    
        } catch (error) {
            // Check if the session ID is invalid/expired
            if (error.name === "ValidationException" && error.message.toLowerCase().includes("session")) {
                console.warn(`Session ${sessionId} invalid/expired. Retrying with fresh session.`);
                const retryCommand = new RetrieveAndGenerateCommand(createCommandInput(null));
                response = await client.send(retryCommand);
            } else {
                throw error;
            }
        }

        return {
            statusCode: 200,
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
            body: JSON.stringify({ 
                error: "Internal Server Error", 
                message: error.message 
            })
        };
    }
};
