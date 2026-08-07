'use server';
/**
 * @fileOverview A Genkit flow for providing contextual explanations of rock art enhancement filters.
 *
 * - explainRockArtFilter - A function that requests an explanation for a given filter applied to an image.
 * - ContextualRockArtFilterExplanationInput - The input type for the explainRockArtFilter function.
 * - ContextualRockArtFilterExplanationOutput - The return type for the explainRockArtFilter function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Define the schema for the input to the explanation flow.
const ContextualRockArtFilterExplanationInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of rock art, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  appliedFilterId: z.string().describe('The ID of the enhancement filter that was applied (e.g., "red", "white", "lds").'),
  currentIntensity: z.number().min(0.5).max(3.0).describe('The intensity level at which the filter was applied (between 0.5 and 3.0).'),
});
export type ContextualRockArtFilterExplanationInput = z.infer<typeof ContextualRockArtFilterExplanationInputSchema>;

// Define the schema for the output of the explanation flow.
const ContextualRockArtFilterExplanationOutputSchema = z.object({
  explanation: z.string().describe('A brief, contextual explanation of why the filter was chosen or what it aims to highlight, based on the image characteristics and filter purpose.'),
});
export type ContextualRockArtFilterExplanationOutput = z.infer<typeof ContextualRockArtFilterExplanationOutputSchema>;

// Define a map of filter IDs to their descriptions for embedding into the prompt.
const filterDescriptions: { [key: string]: string } = {
  "red": "Enhances the a* channel in LAB color space, optimized for red pigments. It aims to make red pigments more visible and distinct.",
  "white": "Boosts differential luminosity in low saturation areas, optimized for white pigments. It aims to emphasize white pigments by increasing their brightness and contrast against the rock.",
  "bichrome": "A combined filter that enhances red and white pigments while suppressing the rock substrate. It's used for rock art with both red and white elements.",
  "black": "Enhances dark achromatic pigments by L* contrast, optimized for black pigments. It aims to make black pigments more prominent and separate them from shadows.",
  "ybk": "Performs chrominance stretching in YCbCr color space (equivalent to DStretch YBK). It's a general-purpose enhancement for overall pigment visibility.",
  "lds": "Applies a full decorrelation stretch with Principal Component Analysis (PCA). This is a strong, general-purpose enhancement that maximizes color separation for various pigments.",
  "clahe": "Applies adaptive local contrast enhancement by blocks (CLAHE-like). It improves local detail and visibility across the image, useful for subtle or faded art.",
  "map": "Generates a false-color mapping where red corresponds to red pigment, green to black pigment, cyan to white pigment, and grey to the rock substrate. It's used for visualizing the distribution of different pigment types.",
};

// Embed the filter descriptions into the prompt string.
const embeddedFilterDescriptions = Object.entries(filterDescriptions)
  .map(([id, desc]) => `- ${id}: ${desc}`)
  .join('\n');

// Define the Genkit prompt for generating filter explanations.
const explainFilterPrompt = ai.definePrompt({
  name: 'explainRockArtFilterPrompt',
  input: { schema: ContextualRockArtFilterExplanationInputSchema },
  output: { schema: ContextualRockArtFilterExplanationOutputSchema },
  model: googleAI.model('gemini-2.5-flash-image'), // Using a multi-modal model for image context
  prompt: `You are an expert in rock art digital enhancement and analysis.
A rock art image has been processed with a specific enhancement filter.
Your task is to provide a brief, contextual explanation (maximum 3 sentences) of why this specific filter was chosen or what it aims to highlight based on the characteristics of the image.
Consider the visual content of the image and the general purpose of the applied filter.

Here are the general purposes of the available filters:
${embeddedFilterDescriptions}

The applied filter ID is: {{{appliedFilterId}}}
The intensity of the filter was: {{{currentIntensity}}}

Image: {{media url=photoDataUri}}

Provide a concise explanation, focusing on how the filter's mechanism interacts with potential features in the rock art to achieve its enhancement goal.`,
});

// Define the Genkit flow.
const explainRockArtFilterFlow = ai.defineFlow(
  {
    name: 'explainRockArtFilterFlow',
    inputSchema: ContextualRockArtFilterExplanationInputSchema,
    outputSchema: ContextualRockArtFilterExplanationOutputSchema,
  },
  async (input) => {
    const { output } = await explainFilterPrompt(input);
    return output!;
  }
);

// Export a wrapper function for the flow.
export async function explainRockArtFilter(
  input: ContextualRockArtFilterExplanationInput
): Promise<ContextualRockArtFilterExplanationOutput> {
  return explainRockArtFilterFlow(input);
}
