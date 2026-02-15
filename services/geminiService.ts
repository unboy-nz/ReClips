import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VoiceName, StoryTone, ToneDescriptions } from "../types";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    if (!process.env.API_KEY) {
      throw new Error("API Key is missing from environment variables.");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async fetchTranscriptFromUrl(url: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `I have a YouTube video at this URL: ${url}. Please find and provide the full transcript or a very detailed scene-by-scene breakdown of this video. I need the raw text to rewrite it into a recap script later. Return only the transcript content.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text;
      if (!text || text.length < 50) {
        throw new Error("Could not retrieve a valid transcript. Please try pasting it manually.");
      }
      return text;
    } catch (error) {
      console.error("Error fetching via Search:", error);
      throw new Error("Failed to fetch transcript using Google Search. Please ensure the URL is correct or paste the transcript manually.");
    }
  }

  async processVideo(base64Data: string, mimeType: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: "Please watch this video and provide a comprehensive transcript or a highly detailed scene-by-scene breakdown. I will use this as the foundation for a movie recap script. Include dialogue if audible and describe key visual plot points clearly.",
            },
          ],
        },
      });

      return response.text || "ဗီဒီယိုကို နားမလည်နိုင်ပါ။ ကျေးဇူးပြု၍ အခြားဗီဒီယိုတစ်ခု စမ်းကြည့်ပါ။";
    } catch (error: any) {
      console.error("Error processing video:", error);
      if (error.status === 403 || error.code === 403) {
        throw new Error("Permission denied. This model may not support video input or requires a different API key tier.");
      }
      if (error.status === 413) {
        throw new Error("Video file is too large for direct processing.");
      }
      throw new Error("Failed to process video file. Ensure it is a valid video and not too large.");
    }
  }

  async generateTitle(script: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Based on this movie recap script, generate one short, extremely catchy, and dramatic title in Burmese. Do not use quotes or extra text. Just the title.
        
        Script: ${script}`,
      });
      return response.text?.trim() || "Untitled Recap";
    } catch (error) {
      console.error("Error generating title:", error);
      return "Untitled Recap";
    }
  }

  async generateRecapScript(transcript: string, tone: StoryTone = StoryTone.Dramatic): Promise<string> {
    const toneInfo = ToneDescriptions[tone];
    
    const systemPrompt = `You are a professional Burmese YouTuber and Movie Recap Storyteller (ဇာတ်လမ်းပြောပြသူ).
Your task is to rewrite the provided transcript into a highly engaging "Movie Recap Style" script in natural Burmese spoken language (လူပြောစကား style).

Target Tone: ${toneInfo.label} (${toneInfo.description})

Storytelling Guidelines for Burmese:
1. Pacing & Flow: Use short, punchy sentences. Avoid long, complex academic phrases.
2. Natural Narration: Use conversational Burmese particles correctly (e.g., "တယ်" instead of "သည်" for endings where appropriate for narration).
3. Transitions: Use dramatic transitions such as:
   - "ဒါပေမယ့် တကယ်တော့..." (But in reality...)
   - "ဘယ်သူမှ မထင်ထားတဲ့ အလှည့်အပြောင်းတစ်ခုက..." (An unexpected twist...)
   - "အခြေအနေတွေက လုံးဝ ပြောင်းလဲသွားခဲ့တယ်..." (Situations changed completely...)
   - "ပရိသတ်တို့ရော ဘယ်လိုထင်လဲ..." (What do you think, audience?)
4. Emotional Impact: Describe scenes with expressive Burmese adjectives. Instead of just saying "He was sad," describe the weight of the moment.
5. Specific Tone Adaptation:
   - ${StoryTone.Dramatic}: Deep, emotional, emphasizing personal loss or triumph.
   - ${StoryTone.Suspense}: Slower build-up, using words like "လျှို့ဝှက်ဆန်းကြယ်စွာနဲ့," "ခြောက်ခြားစရာကောင်းတဲ့."
   - ${StoryTone.Comedy}: Light-hearted, using modern Burmese slang (လူငယ်သုံးစကား) and witty observations.
   - ${StoryTone.Action}: Fast, energetic, focusing on movement and intensity.

Structure:
- Start with a powerful hook.
- Tell the story chronologically or thematically, maintaining the "Recap Narrator" persona.
- End with a thought-provoking conclusion or a cliffhanger summary.

Do NOT include camera directions or scene numbers. ONLY the narration script.`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: transcript,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.85,
        }
      });

      return response.text || "ဇာတ်လမ်းကို ပြန်လည်ပြောပြဖို့ အခက်အခဲရှိနေပါတယ်။ ကျေးဇူးပြု၍ ထပ်မံကြိုးစားကြည့်ပါ။";
    } catch (error) {
      console.error("Error generating script:", error);
      throw new Error("Failed to generate Burmese recap script.");
    }
  }

  async extractHooks(script: string): Promise<string[]> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Extract 3 most catchy and dramatic opening 'hooks' (intro sentences) from this Burmese movie recap script. These should be designed to grab the audience's attention in the first 5 seconds.
        
        Script: ${script}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hooks: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of 3 catchy hooks in Burmese"
              }
            },
            required: ["hooks"]
          }
        }
      });

      const json = JSON.parse(response.text.trim());
      return json.hooks || [];
    } catch (error) {
      console.error("Error extracting hooks:", error);
      return [];
    }
  }

  async generateAudio(text: string, voice: VoiceName = VoiceName.Kore): Promise<string> {
    try {
      // Standard TTS Prompt refined for storytelling rhythm
      const ttsPrompt = `Please narrate the following Burmese text as a professional movie recap storyteller. 
      Pay close attention to pauses (,), emphasis on dramatic words, and maintain an engaging storytelling rhythm. 
      Use a voice that matches a narrative persona.

      Text: ${text}`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice as any },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error("Gemini TTS model did not return any candidates.");
      }

      const audioPart = candidate.content?.parts?.find(part => part.inlineData && part.inlineData.data);
      if (audioPart && audioPart.inlineData) {
        return audioPart.inlineData.data;
      }

      throw new Error("No audio data found in the model response.");
    } catch (error: any) {
      console.error("Gemini TTS Error:", error);
      throw new Error(error.message || "Failed to generate audio narration.");
    }
  }
}