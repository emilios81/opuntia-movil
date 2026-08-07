'use server';
/**
 * @fileOverview A Genkit flow for recommending the most suitable rock art enhancement filter based on an uploaded image.
 *
 * - recommendRockArtFilter: A function that triggers the filter recommendation process.
 * - RecommendRockArtFilterInput: The input type for the recommendRockArtFilter function.
 * - RecommendRockArtFilterOutput: The return type for the recommendRockArtFilter function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Input Schema for the flow
const RecommendRockArtFilterInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of rock art, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  userDescription: z
    .string()
    .optional()
    .describe('An optional description provided by the user about the rock art image or desired enhancement.'),
});
export type RecommendRockArtFilterInput = z.infer<typeof RecommendRockArtFilterInputSchema>;

// Output Schema for the flow
const RecommendRockArtFilterOutputSchema = z.object({
  recommendedFilterId: z
    .enum(["red", "white", "bichrome", "black", "ybk", "lds", "clahe", "map"])
    .describe('The ID of the recommended rock art enhancement filter.'),
  reasoning: z
    .string()
    .describe('A brief explanation of why this filter was recommended based on the image analysis.'),
});
export type RecommendRockArtFilterOutput = z.infer<typeof RecommendRockArtFilterOutputSchema>;

// Define the prompt for the LLM
const recommendFilterPrompt = ai.definePrompt({
  name: 'recommendRockArtFilterPrompt',
  input: { schema: RecommendRockArtFilterInputSchema },
  output: { schema: RecommendRockArtFilterOutputSchema },
  prompt: `You are an expert in rock art analysis and digital image enhancement.
Your task is to analyze the provided rock art image and recommend the most suitable enhancement filter from the list below.
Consider the visual characteristics of the rock art, such as dominant pigment colors, contrast, and overall visibility.

Here are the available filters and their descriptions:
- red: "Realza canal a* en LAB, optimizado para pigmentos rojos" (Enhances a* channel in LAB, optimized for red pigments)
- white: "Potencia luminosidad diferencial en áreas de baja saturación" (Boosts differential luminosity in low saturation areas, for white pigments)
- bichrome: "Combinado: realza rojos, blancos y suprime sustrato" (Combined: enhances reds, whites, and suppresses substrate, for bichrome panels)
- black: "Realza pigmentos oscuros acromáticos por contraste L*" (Enhances dark achromatic pigments by L* contrast, for black pigments)
- ybk: "Estiramiento de crominancia en YCbCr (equiv. DStretch YBK)" (Chrominance stretching in YCbCr, equivalent to DStretch YBK - general purpose)
- lds: "Decorrelation stretch completo con PCA" (Full decorrelation stretch with PCA - strong decorrelation)
- clahe: "Contraste local adaptativo por bloques" (Adaptive local contrast enhancement by blocks)
- map: "Falso color: rojo=pigm. rojo, verde=negro, cyan=blanco, gris=roca" (False color: red=red pigment, green=black, cyan=white, gray=rock - for pigment mapping)

Image to analyze: {{media url=photoDataUri}}
{{#if userDescription}}
The user also provided this description: "{{{userDescription}}}"
{{/if}}

Based on your analysis, recommend one filter ID and explain your reasoning.
Focus on identifying the most prominent pigment types (red, white, black) or areas needing general contrast/color enhancement.
The output should be a JSON object conforming to the RecommendRockArtFilterOutputSchema.
`
});

// Define the Genkit flow
const recommendRockArtFilterFlow = ai.defineFlow(
  {
    name: 'recommendRockArtFilterFlow',
    inputSchema: RecommendRockArtFilterInputSchema,
    outputSchema: RecommendRockArtFilterOutputSchema,
  },
  async (input) => {
    const { output } = await recommendFilterPrompt(input);
    if (!output) {
      throw new Error('Failed to get a recommendation from the AI model.');
    }
    return output;
  }
);

// Wrapper function to export for Next.js React code
export async function recommendRockArtFilter(
  input: RecommendRockArtFilterInput
): Promise<RecommendRockArtFilterOutput> {
  return recommendRockArtFilterFlow(input);
}
