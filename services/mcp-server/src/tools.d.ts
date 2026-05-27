/**
 * MCP Tool definitions for DMR-X
 *
 * Each tool maps to a DMR-X modality and accepts parameters
 * matching the OpenAI-compatible API surface.
 */
import { z } from 'zod';
export declare const ChatMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["system", "user", "assistant", "tool"]>;
    content: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        text: string;
        type: "text";
    }, {
        text: string;
        type: "text";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image_url">;
        image_url: z.ZodObject<{
            url: z.ZodString;
            detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        }, {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    }, {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"input_audio">;
        input_audio: z.ZodObject<{
            data: z.ZodString;
            format: z.ZodEnum<["wav", "mp3"]>;
        }, "strip", z.ZodTypeAny, {
            data: string;
            format: "wav" | "mp3";
        }, {
            data: string;
            format: "wav" | "mp3";
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "input_audio";
        input_audio: {
            data: string;
            format: "wav" | "mp3";
        };
    }, {
        type: "input_audio";
        input_audio: {
            data: string;
            format: "wav" | "mp3";
        };
    }>]>, "many">]>;
    name: z.ZodOptional<z.ZodString>;
    tool_call_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    content: string | ({
        text: string;
        type: "text";
    } | {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    } | {
        type: "input_audio";
        input_audio: {
            data: string;
            format: "wav" | "mp3";
        };
    })[];
    role: "user" | "assistant" | "tool" | "system";
    name?: string | undefined;
    tool_call_id?: string | undefined;
}, {
    content: string | ({
        text: string;
        type: "text";
    } | {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    } | {
        type: "input_audio";
        input_audio: {
            data: string;
            format: "wav" | "mp3";
        };
    })[];
    role: "user" | "assistant" | "tool" | "system";
    name?: string | undefined;
    tool_call_id?: string | undefined;
}>;
export declare const ToolSchema: z.ZodObject<{
    type: z.ZodLiteral<"function">;
    function: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        parameters?: Record<string, unknown> | undefined;
    }, {
        name: string;
        description?: string | undefined;
        parameters?: Record<string, unknown> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    function: {
        name: string;
        description?: string | undefined;
        parameters?: Record<string, unknown> | undefined;
    };
    type: "function";
}, {
    function: {
        name: string;
        description?: string | undefined;
        parameters?: Record<string, unknown> | undefined;
    };
    type: "function";
}>;
export declare const ToolChoiceSchema: z.ZodUnion<[z.ZodLiteral<"auto">, z.ZodLiteral<"none">, z.ZodLiteral<"required">, z.ZodObject<{
    type: z.ZodLiteral<"function">;
    function: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
    }>;
}, "strip", z.ZodTypeAny, {
    function: {
        name: string;
    };
    type: "function";
}, {
    function: {
        name: string;
    };
    type: "function";
}>]>;
export declare const dmrxChatParams: {
    readonly messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant", "tool"]>;
        content: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            text: string;
            type: "text";
        }, {
            text: string;
            type: "text";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image_url">;
            image_url: z.ZodObject<{
                url: z.ZodString;
                detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
            }, "strip", z.ZodTypeAny, {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            }, {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        }, {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"input_audio">;
            input_audio: z.ZodObject<{
                data: z.ZodString;
                format: z.ZodEnum<["wav", "mp3"]>;
            }, "strip", z.ZodTypeAny, {
                data: string;
                format: "wav" | "mp3";
            }, {
                data: string;
                format: "wav" | "mp3";
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "input_audio";
            input_audio: {
                data: string;
                format: "wav" | "mp3";
            };
        }, {
            type: "input_audio";
            input_audio: {
                data: string;
                format: "wav" | "mp3";
            };
        }>]>, "many">]>;
        name: z.ZodOptional<z.ZodString>;
        tool_call_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        content: string | ({
            text: string;
            type: "text";
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "input_audio";
            input_audio: {
                data: string;
                format: "wav" | "mp3";
            };
        })[];
        role: "user" | "assistant" | "tool" | "system";
        name?: string | undefined;
        tool_call_id?: string | undefined;
    }, {
        content: string | ({
            text: string;
            type: "text";
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "input_audio";
            input_audio: {
                data: string;
                format: "wav" | "mp3";
            };
        })[];
        role: "user" | "assistant" | "tool" | "system";
        name?: string | undefined;
        tool_call_id?: string | undefined;
    }>, "many">;
    readonly model: z.ZodOptional<z.ZodString>;
    readonly temperature: z.ZodOptional<z.ZodNumber>;
    readonly max_tokens: z.ZodOptional<z.ZodNumber>;
    readonly top_p: z.ZodOptional<z.ZodNumber>;
    readonly frequency_penalty: z.ZodOptional<z.ZodNumber>;
    readonly presence_penalty: z.ZodOptional<z.ZodNumber>;
    readonly stop: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    readonly response_format: z.ZodOptional<z.ZodEnum<["text", "json_object"]>>;
    readonly seed: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    readonly n: z.ZodOptional<z.ZodNumber>;
    readonly tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"function">;
        function: z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            parameters?: Record<string, unknown> | undefined;
        }, {
            name: string;
            description?: string | undefined;
            parameters?: Record<string, unknown> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        function: {
            name: string;
            description?: string | undefined;
            parameters?: Record<string, unknown> | undefined;
        };
        type: "function";
    }, {
        function: {
            name: string;
            description?: string | undefined;
            parameters?: Record<string, unknown> | undefined;
        };
        type: "function";
    }>, "many">>;
    readonly tool_choice: z.ZodOptional<z.ZodUnion<[z.ZodLiteral<"auto">, z.ZodLiteral<"none">, z.ZodLiteral<"required">, z.ZodObject<{
        type: z.ZodLiteral<"function">;
        function: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        function: {
            name: string;
        };
        type: "function";
    }, {
        function: {
            name: string;
        };
        type: "function";
    }>]>>;
    readonly quality_target: z.ZodOptional<z.ZodEnum<["frontier", "balanced", "economy"]>>;
    readonly user: z.ZodOptional<z.ZodString>;
};
export declare const dmrxGenerateImageParams: {
    readonly prompt: z.ZodString;
    readonly negative_prompt: z.ZodOptional<z.ZodString>;
    readonly model: z.ZodOptional<z.ZodString>;
    readonly width: z.ZodOptional<z.ZodNumber>;
    readonly height: z.ZodOptional<z.ZodNumber>;
    readonly steps: z.ZodOptional<z.ZodNumber>;
    readonly seed: z.ZodOptional<z.ZodNumber>;
    readonly style: z.ZodOptional<z.ZodString>;
    readonly cfg_scale: z.ZodOptional<z.ZodNumber>;
    readonly n: z.ZodOptional<z.ZodNumber>;
    readonly quality_target: z.ZodOptional<z.ZodEnum<["frontier", "balanced", "economy"]>>;
    readonly user: z.ZodOptional<z.ZodString>;
};
export declare const dmrxEmbedParams: {
    readonly input: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    readonly model: z.ZodOptional<z.ZodString>;
    readonly dimensions: z.ZodOptional<z.ZodNumber>;
    readonly encoding_format: z.ZodOptional<z.ZodEnum<["float", "base64"]>>;
    readonly quality_target: z.ZodOptional<z.ZodEnum<["frontier", "balanced", "economy"]>>;
    readonly user: z.ZodOptional<z.ZodString>;
};
export declare const dmrxTranscribeParams: {
    readonly audio: z.ZodString;
    readonly audio_format: z.ZodOptional<z.ZodEnum<["wav", "mp3", "m4a", "webm"]>>;
    readonly model: z.ZodOptional<z.ZodString>;
    readonly language: z.ZodOptional<z.ZodString>;
    readonly quality_target: z.ZodOptional<z.ZodEnum<["frontier", "balanced", "economy"]>>;
    readonly user: z.ZodOptional<z.ZodString>;
};
export declare const dmrxSpeakParams: {
    readonly input: z.ZodString;
    readonly model: z.ZodOptional<z.ZodString>;
    readonly voice: z.ZodOptional<z.ZodString>;
    readonly speed: z.ZodOptional<z.ZodNumber>;
    readonly format: z.ZodOptional<z.ZodString>;
    readonly language: z.ZodOptional<z.ZodString>;
    readonly quality_target: z.ZodOptional<z.ZodEnum<["frontier", "balanced", "economy"]>>;
    readonly user: z.ZodOptional<z.ZodString>;
};
export declare const dmrxRerankParams: {
    readonly query: z.ZodString;
    readonly documents: z.ZodArray<z.ZodString, "many">;
    readonly model: z.ZodOptional<z.ZodString>;
    readonly top_n: z.ZodOptional<z.ZodNumber>;
    readonly quality_target: z.ZodOptional<z.ZodEnum<["frontier", "balanced", "economy"]>>;
    readonly user: z.ZodOptional<z.ZodString>;
};
export declare const dmrxModelsParams: {
    readonly modality: z.ZodOptional<z.ZodEnum<["llm", "diffusion", "embedding", "audio_tts", "audio_stt", "video", "music", "reranking", "moderation", "code_completion"]>>;
    readonly provider: z.ZodOptional<z.ZodString>;
};
export declare const dmrxStatusParams: {
    readonly include_models: z.ZodOptional<z.ZodBoolean>;
    readonly include_providers: z.ZodOptional<z.ZodBoolean>;
};
export declare const TOOL_NAMES: {
    readonly CHAT: "dmrx_chat";
    readonly GENERATE_IMAGE: "dmrx_generate_image";
    readonly EMBED: "dmrx_embed";
    readonly TRANSCRIBE: "dmrx_transcribe";
    readonly SPEAK: "dmrx_speak";
    readonly RERANK: "dmrx_rerank";
    readonly MODELS: "dmrx_models";
    readonly STATUS: "dmrx_status";
};
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
export declare const TOOL_DESCRIPTIONS: Record<ToolName, string>;
//# sourceMappingURL=tools.d.ts.map