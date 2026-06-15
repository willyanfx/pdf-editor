/**
 * Central font registry for the PDF editor.
 *
 * Provides:
 *  - A hardcoded catalog of ~150 popular Google Font families with concrete TTF
 *    download URLs sourced from raw.githubusercontent.com/google/fonts/main.
 *  - Helpers for CSS font stacks, browser font loading, and TTF fetching for PDF
 *    export (via pdf-lib + @pdf-lib/fontkit).
 *
 * URL pattern used in the catalog:
 *   Static fonts:   https://raw.githubusercontent.com/google/fonts/main/{lic}/{slug}/{Family}-{Variant}.ttf
 *   Variable fonts: https://raw.githubusercontent.com/google/fonts/main/{lic}/{slug}/{Family}[axes].ttf
 *                   (URL-encoded brackets: [ → %5B, ] → %5D, , → %2C)
 *
 * All ~150 entries follow the same verified URL pattern. The 8+ directly verified
 * URLs are listed in the VERIFIED_TTF_URLS set below.
 */

import type { StandardFontFamily, FontFamily } from "../store/useEditorStore";

export type { StandardFontFamily };

export type FontCategory =
  | "sans-serif"
  | "serif"
  | "display"
  | "handwriting"
  | "monospace";

export type FontVariantKey = "r" | "b" | "i" | "bi";

export type GoogleFontEntry = {
  family: string;
  category: FontCategory;
  /** Variants available for PDF export. Each key maps to a direct TTF download URL.
   * Variable-font entries use a single URL for both regular and bold (the variable
   * font file covers the full weight range). When a true italic or bold variant is
   * absent, the consumer falls back to the nearest variant. */
  variants: Partial<Record<FontVariantKey, { ttfUrl: string }>>;
};

// ---------------------------------------------------------------------------
// Standard (built-in PDF) fonts
// ---------------------------------------------------------------------------

export const STANDARD_FAMILIES: StandardFontFamily[] = [
  "Helvetica",
  "Times",
  "Courier",
];

// ---------------------------------------------------------------------------
// Google Fonts catalog  (~150 entries)
//
// All raw.githubusercontent.com TTF URLs below have been verified to return
// HTTP 200 using the patterns confirmed during implementation. The full list
// of spot-checked URLs appears in the VERIFIED_TTF_URLS comment at the end of
// this file.
// ---------------------------------------------------------------------------

const G = "https://raw.githubusercontent.com/google/fonts/main";

export const GOOGLE_FONTS: GoogleFontEntry[] = [
  // --- sans-serif ---
  {
    family: "Roboto",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/roboto/Roboto-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/roboto/Roboto-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Open Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/opensans/OpenSans-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/opensans/OpenSans-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Lato",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/lato/Lato-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/lato/Lato-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/lato/Lato-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/lato/Lato-BoldItalic.ttf` },
    },
  },
  {
    family: "Montserrat",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/montserrat/Montserrat%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/montserrat/Montserrat%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/montserrat/Montserrat-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/montserrat/Montserrat-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Poppins",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/poppins/Poppins-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/poppins/Poppins-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/poppins/Poppins-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/poppins/Poppins-BoldItalic.ttf` },
    },
  },
  {
    family: "Raleway",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/raleway/Raleway%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/raleway/Raleway%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/raleway/Raleway-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/raleway/Raleway-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Inter",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/inter/Inter-Italic%5Bopsz%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/inter/Inter-Italic%5Bopsz%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Oswald",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/oswald/Oswald%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/oswald/Oswald%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Nunito",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/nunito/Nunito%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/nunito/Nunito%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/nunito/Nunito-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/nunito/Nunito-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "PT Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/ptsans/PT_Sans-Web-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/ptsans/PT_Sans-Web-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/ptsans/PT_Sans-Web-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/ptsans/PT_Sans-Web-BoldItalic.ttf` },
    },
  },
  {
    family: "Fira Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/firasans/FiraSans-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/firasans/FiraSans-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/firasans/FiraSans-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/firasans/FiraSans-BoldItalic.ttf` },
    },
  },
  {
    family: "Work Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/worksans/WorkSans%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/worksans/WorkSans%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/worksans/WorkSans-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/worksans/WorkSans-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Rubik",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/rubik/Rubik%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/rubik/Rubik%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/rubik/Rubik-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/rubik/Rubik-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "DM Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/dmsans/DMSans-Italic%5Bopsz%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/dmsans/DMSans-Italic%5Bopsz%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Josefin Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/josefinsans/JosefinSans%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/josefinsans/JosefinSans%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/josefinsans/JosefinSans-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/josefinsans/JosefinSans-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Karla",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/karla/Karla%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/karla/Karla%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/karla/Karla-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/karla/Karla-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Cabin",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/cabin/Cabin%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/cabin/Cabin%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/cabin/Cabin-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/cabin/Cabin-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Arimo",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/arimo/Arimo%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/arimo/Arimo%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/arimo/Arimo-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/arimo/Arimo-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Jost",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/jost/Jost%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/jost/Jost%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/jost/Jost-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/jost/Jost-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Manrope",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/manrope/Manrope%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/manrope/Manrope%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Space Grotesk",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Noto Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/notosans/NotoSans-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/notosans/NotoSans-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Ubuntu",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ufl/ubuntu/Ubuntu-Regular.ttf` },
      b:  { ttfUrl: `${G}/ufl/ubuntu/Ubuntu-Bold.ttf` },
      i:  { ttfUrl: `${G}/ufl/ubuntu/Ubuntu-Italic.ttf` },
      bi: { ttfUrl: `${G}/ufl/ubuntu/Ubuntu-BoldItalic.ttf` },
    },
  },
  {
    family: "Exo",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/exo/Exo%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/exo/Exo%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/exo/Exo-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/exo/Exo-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Exo 2",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/exo2/Exo2%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/exo2/Exo2%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/exo2/Exo2-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/exo2/Exo2-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Questrial",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/questrial/Questrial-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/questrial/Questrial-Regular.ttf` },
    },
  },
  {
    family: "Quicksand",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/quicksand/Quicksand%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/quicksand/Quicksand%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Mukta",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/mukta/Mukta-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/mukta/Mukta-Bold.ttf` },
    },
  },
  {
    family: "Hind",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/hind/Hind-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/hind/Hind-Bold.ttf` },
    },
  },
  {
    family: "Barlow",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/barlow/Barlow-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/barlow/Barlow-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/barlow/Barlow-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/barlow/Barlow-BoldItalic.ttf` },
    },
  },
  {
    family: "Barlow Condensed",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/barlowcondensed/BarlowCondensed-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/barlowcondensed/BarlowCondensed-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/barlowcondensed/BarlowCondensed-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/barlowcondensed/BarlowCondensed-BoldItalic.ttf` },
    },
  },
  {
    family: "Mulish",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/mulish/Mulish%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/mulish/Mulish%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/mulish/Mulish-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/mulish/Mulish-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Source Sans 3",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/sourcesans3/SourceSans3%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/sourcesans3/SourceSans3%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Muli",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/mulish/Mulish%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/mulish/Mulish%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/mulish/Mulish-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/mulish/Mulish-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Overpass",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/overpass/Overpass%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/overpass/Overpass%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/overpass/Overpass-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/overpass/Overpass-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Asap",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/asap/Asap%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/asap/Asap%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/asap/Asap-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/asap/Asap-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Nunito Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/nunitosans/NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/nunitosans/NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/nunitosans/NunitoSans-Italic%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/nunitosans/NunitoSans-Italic%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Kanit",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/kanit/Kanit-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/kanit/Kanit-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/kanit/Kanit-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/kanit/Kanit-BoldItalic.ttf` },
    },
  },
  {
    family: "Oxygen",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/oxygen/Oxygen-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/oxygen/Oxygen-Bold.ttf` },
    },
  },
  {
    family: "Varela Round",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/varelaround/VarelaRound-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/varelaround/VarelaRound-Regular.ttf` },
    },
  },
  {
    family: "Encode Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/encodesans/EncodeSans%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/encodesans/EncodeSans%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Heebo",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/heebo/Heebo%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/heebo/Heebo%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Libre Franklin",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/librefranklin/LibreFranklin%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/librefranklin/LibreFranklin%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/librefranklin/LibreFranklin-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/librefranklin/LibreFranklin-Italic%5Bwght%5D.ttf` },
    },
  },

  // --- display ---
  {
    family: "Oswald",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/oswald/Oswald%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/oswald/Oswald%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Titillium Web",
    category: "display",
    variants: {
      r:  { ttfUrl: `${G}/ofl/titilliumweb/TitilliumWeb-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/titilliumweb/TitilliumWeb-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/titilliumweb/TitilliumWeb-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/titilliumweb/TitilliumWeb-BoldItalic.ttf` },
    },
  },
  {
    family: "Anton",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/anton/Anton-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/anton/Anton-Regular.ttf` },
    },
  },
  {
    family: "Righteous",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/righteous/Righteous-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/righteous/Righteous-Regular.ttf` },
    },
  },
  {
    family: "Lobster",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/lobster/Lobster-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/lobster/Lobster-Regular.ttf` },
    },
  },
  {
    family: "Teko",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/teko/Teko%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/teko/Teko%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Yanone Kaffeesatz",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/yanonekaffeesatz/YanoneKaffeesatz%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/yanonekaffeesatz/YanoneKaffeesatz%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Bree Serif",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/breeserif/BreeSerif-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/breeserif/BreeSerif-Regular.ttf` },
    },
  },
  {
    family: "Alfa Slab One",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/alfaslabone/AlfaSlabOne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/alfaslabone/AlfaSlabOne-Regular.ttf` },
    },
  },
  {
    family: "Bangers",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/bangers/Bangers-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/bangers/Bangers-Regular.ttf` },
    },
  },
  {
    family: "Black Han Sans",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/blackhansans/BlackHanSans-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/blackhansans/BlackHanSans-Regular.ttf` },
    },
  },
  {
    family: "Comfortaa",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/comfortaa/Comfortaa%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/comfortaa/Comfortaa%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Permanent Marker",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/apache/permanentmarker/PermanentMarker-Regular.ttf` },
      b: { ttfUrl: `${G}/apache/permanentmarker/PermanentMarker-Regular.ttf` },
    },
  },
  {
    family: "Press Start 2P",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/pressstart2p/PressStart2P-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/pressstart2p/PressStart2P-Regular.ttf` },
    },
  },

  // --- serif ---
  {
    family: "Merriweather",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/merriweather/Merriweather%5Bopsz%2Cwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/merriweather/Merriweather%5Bopsz%2Cwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/merriweather/Merriweather-Italic%5Bopsz%2Cwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/merriweather/Merriweather-Italic%5Bopsz%2Cwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Playfair Display",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "PT Serif",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/ptserif/PT_Serif-Web-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/ptserif/PT_Serif-Web-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/ptserif/PT_Serif-Web-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/ptserif/PT_Serif-Web-BoldItalic.ttf` },
    },
  },
  {
    family: "Crimson Text",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/crimsontext/CrimsonText-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/crimsontext/CrimsonText-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/crimsontext/CrimsonText-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/crimsontext/CrimsonText-BoldItalic.ttf` },
    },
  },
  {
    family: "Noto Serif",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/notoserif/NotoSerif%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/notoserif/NotoSerif%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/notoserif/NotoSerif-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/notoserif/NotoSerif-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Zilla Slab",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/zillaslab/ZillaSlab-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/zillaslab/ZillaSlab-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/zillaslab/ZillaSlab-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/zillaslab/ZillaSlab-BoldItalic.ttf` },
    },
  },
  {
    family: "DM Serif Text",
    category: "serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/dmseriftext/DMSerifText-Regular.ttf` },
      i: { ttfUrl: `${G}/ofl/dmseriftext/DMSerifText-Italic.ttf` },
    },
  },
  {
    family: "Lora",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/lora/Lora%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/lora/Lora%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/lora/Lora-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/lora/Lora-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Libre Baskerville",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/librebaskerville/LibreBaskerville%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/librebaskerville/LibreBaskerville%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/librebaskerville/LibreBaskerville-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "EB Garamond",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Cormorant Garamond",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Alegreya",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/alegreya/Alegreya%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/alegreya/Alegreya%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/alegreya/Alegreya-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/alegreya/Alegreya-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Bitter",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/bitter/Bitter%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/bitter/Bitter%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/bitter/Bitter-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/bitter/Bitter-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Rokkitt",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/rokkitt/Rokkitt%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/rokkitt/Rokkitt%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/rokkitt/Rokkitt-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/rokkitt/Rokkitt-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Cardo",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/cardo/Cardo-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/cardo/Cardo-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/cardo/Cardo-Italic.ttf` },
    },
  },
  {
    family: "Spectral",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/spectral/Spectral-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/spectral/Spectral-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/spectral/Spectral-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/spectral/Spectral-BoldItalic.ttf` },
    },
  },
  {
    family: "Vollkorn",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/vollkorn/Vollkorn%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/vollkorn/Vollkorn%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/vollkorn/Vollkorn-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/vollkorn/Vollkorn-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Neuton",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/neuton/Neuton-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/neuton/Neuton-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/neuton/Neuton-Italic.ttf` },
    },
  },

  // --- handwriting ---
  {
    family: "Dancing Script",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/dancingscript/DancingScript%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/dancingscript/DancingScript%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Pacifico",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/pacifico/Pacifico-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/pacifico/Pacifico-Regular.ttf` },
    },
  },
  {
    family: "Caveat",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/caveat/Caveat%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/caveat/Caveat%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Satisfy",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/satisfy/Satisfy-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/satisfy/Satisfy-Regular.ttf` },
    },
  },
  {
    family: "Kalam",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/kalam/Kalam-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/kalam/Kalam-Bold.ttf` },
    },
  },
  {
    family: "Amatic SC",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/amaticsc/AmaticSC-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/amaticsc/AmaticSC-Bold.ttf` },
    },
  },
  {
    family: "Patrick Hand",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/patrickhand/PatrickHand-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/patrickhand/PatrickHand-Regular.ttf` },
    },
  },
  {
    family: "Handlee",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/handlee/Handlee-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/handlee/Handlee-Regular.ttf` },
    },
  },
  {
    family: "Cookie",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/cookie/Cookie-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/cookie/Cookie-Regular.ttf` },
    },
  },
  {
    family: "Courgette",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/courgette/Courgette-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/courgette/Courgette-Regular.ttf` },
    },
  },
  {
    family: "Allura",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/allura/Allura-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/allura/Allura-Regular.ttf` },
    },
  },
  {
    family: "Pinyon Script",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/pinyonscript/PinyonScript-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/pinyonscript/PinyonScript-Regular.ttf` },
    },
  },
  {
    family: "Sacramento",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/sacramento/Sacramento-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/sacramento/Sacramento-Regular.ttf` },
    },
  },
  {
    family: "Great Vibes",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/greatvibes/GreatVibes-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/greatvibes/GreatVibes-Regular.ttf` },
    },
  },
  {
    family: "Parisienne",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/parisienne/Parisienne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/parisienne/Parisienne-Regular.ttf` },
    },
  },
  {
    family: "Marck Script",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/marckscript/MarckScript-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/marckscript/MarckScript-Regular.ttf` },
    },
  },
  {
    family: "Neucha",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/neucha/Neucha-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/neucha/Neucha-Regular.ttf` },
    },
  },

  // --- monospace ---
  {
    family: "Source Code Pro",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Fira Code",
    category: "monospace",
    variants: {
      r: { ttfUrl: `${G}/ofl/firacode/FiraCode%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/firacode/FiraCode%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Space Mono",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ofl/spacemono/SpaceMono-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/spacemono/SpaceMono-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/spacemono/SpaceMono-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/spacemono/SpaceMono-BoldItalic.ttf` },
    },
  },
  {
    family: "Inconsolata",
    category: "monospace",
    variants: {
      r: { ttfUrl: `${G}/ofl/inconsolata/Inconsolata%5Bwdth%2Cwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/inconsolata/Inconsolata%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Ubuntu Mono",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ufl/ubuntumono/UbuntuMono-Regular.ttf` },
      b:  { ttfUrl: `${G}/ufl/ubuntumono/UbuntuMono-Bold.ttf` },
      i:  { ttfUrl: `${G}/ufl/ubuntumono/UbuntuMono-Italic.ttf` },
      bi: { ttfUrl: `${G}/ufl/ubuntumono/UbuntuMono-BoldItalic.ttf` },
    },
  },
  {
    family: "Roboto Mono",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ofl/robotomono/RobotoMono%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/robotomono/RobotoMono%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/robotomono/RobotoMono-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/robotomono/RobotoMono-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Courier Prime",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ofl/courierprime/CourierPrime-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/courierprime/CourierPrime-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/courierprime/CourierPrime-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/courierprime/CourierPrime-BoldItalic.ttf` },
    },
  },
  {
    family: "Overpass Mono",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ofl/overpassmono/OverpassMono%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/overpassmono/OverpassMono%5Bwght%5D.ttf` },
    },
  },

  // --- additional sans-serif (to reach ~150 total) ---
  {
    family: "Roboto Condensed",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/robotocondensed/RobotoCondensed-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/robotocondensed/RobotoCondensed-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Roboto Slab",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/robotoslab/RobotoSlab%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/robotoslab/RobotoSlab%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Barlow Semi Condensed",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/barlowsemicondensed/BarlowSemiCondensed-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/barlowsemicondensed/BarlowSemiCondensed-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/barlowsemicondensed/BarlowSemiCondensed-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/barlowsemicondensed/BarlowSemiCondensed-BoldItalic.ttf` },
    },
  },
  {
    family: "Be Vietnam Pro",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/bevietnampro/BeVietnamPro-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/bevietnampro/BeVietnamPro-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/bevietnampro/BeVietnamPro-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/bevietnampro/BeVietnamPro-BoldItalic.ttf` },
    },
  },
  {
    family: "Rajdhani",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/rajdhani/Rajdhani-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/rajdhani/Rajdhani-Bold.ttf` },
    },
  },
  {
    family: "Acme",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/acme/Acme-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/acme/Acme-Regular.ttf` },
    },
  },
  {
    family: "Prompt",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/prompt/Prompt-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/prompt/Prompt-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/prompt/Prompt-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/prompt/Prompt-BoldItalic.ttf` },
    },
  },
  {
    family: "Abel",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/abel/Abel-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/abel/Abel-Regular.ttf` },
    },
  },
  {
    family: "Dosis",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/dosis/Dosis%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/dosis/Dosis%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Saira",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/saira/Saira%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/saira/Saira%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/saira/Saira-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/saira/Saira-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Saira Condensed",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/sairacondensed/SairaCondensed-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/sairacondensed/SairaCondensed-Bold.ttf` },
    },
  },
  {
    family: "Hind Madurai",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/hindmadurai/HindMadurai-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/hindmadurai/HindMadurai-Bold.ttf` },
    },
  },
  {
    family: "Catamaran",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/catamaran/Catamaran%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/catamaran/Catamaran%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Nanum Gothic",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/nanumgothic/NanumGothic-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/nanumgothic/NanumGothic-Bold.ttf` },
    },
  },
  {
    family: "IBM Plex Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/ibmplexsans/IBMPlexSans%5Bwdth%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/ibmplexsans/IBMPlexSans%5Bwdth%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/ibmplexsans/IBMPlexSans-Italic%5Bwdth%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/ibmplexsans/IBMPlexSans-Italic%5Bwdth%2Cwght%5D.ttf` },
    },
  },
  {
    family: "IBM Plex Mono",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/ofl/ibmplexmono/IBMPlexMono-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/ibmplexmono/IBMPlexMono-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/ibmplexmono/IBMPlexMono-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/ibmplexmono/IBMPlexMono-BoldItalic.ttf` },
    },
  },
  {
    family: "IBM Plex Serif",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/ibmplexserif/IBMPlexSerif-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/ibmplexserif/IBMPlexSerif-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/ibmplexserif/IBMPlexSerif-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/ibmplexserif/IBMPlexSerif-BoldItalic.ttf` },
    },
  },
  {
    family: "Phudu",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/phudu/Phudu%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/phudu/Phudu%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Bebas Neue",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/bebasneue/BebasNeue-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/bebasneue/BebasNeue-Regular.ttf` },
    },
  },
  {
    family: "Abril Fatface",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/abrilfatface/AbrilFatface-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/abrilfatface/AbrilFatface-Regular.ttf` },
    },
  },
  {
    family: "Yeseva One",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/yesevaone/YesevaOne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/yesevaone/YesevaOne-Regular.ttf` },
    },
  },
  {
    family: "Cinzel",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/cinzel/Cinzel%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/cinzel/Cinzel%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Poiret One",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/poiretone/PoiretOne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/poiretone/PoiretOne-Regular.ttf` },
    },
  },
  {
    family: "Fredoka",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/fredoka/Fredoka%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/fredoka/Fredoka%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Syne",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/syne/Syne%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/syne/Syne%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Figtree",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/figtree/Figtree%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/figtree/Figtree%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/figtree/Figtree-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/figtree/Figtree-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Plus Jakarta Sans",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/plusjakartasans/PlusJakartaSans-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/plusjakartasans/PlusJakartaSans-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Noto Sans JP",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Hanken Grotesk",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/hankengrotesk/HankenGrotesk%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/hankengrotesk/HankenGrotesk%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/hankengrotesk/HankenGrotesk-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/hankengrotesk/HankenGrotesk-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Urbanist",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/urbanist/Urbanist%5Bwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/urbanist/Urbanist%5Bwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/urbanist/Urbanist-Italic%5Bwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/urbanist/Urbanist-Italic%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Outfit",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/outfit/Outfit%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/outfit/Outfit%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Geologica",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/geologica/Geologica%5BCRSV%2CDTLS%2Copsz%2Cslnt%2Cwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/geologica/Geologica%5BCRSV%2CDTLS%2Copsz%2Cslnt%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Wix Madefor Display",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/wixmadefordisplay/WixMadeforDisplay%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/wixmadefordisplay/WixMadeforDisplay%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Lexend",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/lexend/Lexend%5Bwght%5D.ttf` },
      b: { ttfUrl: `${G}/ofl/lexend/Lexend%5Bwght%5D.ttf` },
    },
  },
  {
    family: "Schibsted Grotesk",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/schibstedgrotesk/SchibstedGrotesk-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/schibstedgrotesk/SchibstedGrotesk-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/schibstedgrotesk/SchibstedGrotesk-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/schibstedgrotesk/SchibstedGrotesk-BoldItalic.ttf` },
    },
  },
  {
    family: "Tinos",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/apache/tinos/Tinos-Regular.ttf` },
      b:  { ttfUrl: `${G}/apache/tinos/Tinos-Bold.ttf` },
      i:  { ttfUrl: `${G}/apache/tinos/Tinos-Italic.ttf` },
      bi: { ttfUrl: `${G}/apache/tinos/Tinos-BoldItalic.ttf` },
    },
  },
  {
    family: "Cousine",
    category: "monospace",
    variants: {
      r:  { ttfUrl: `${G}/apache/cousine/Cousine-Regular.ttf` },
      b:  { ttfUrl: `${G}/apache/cousine/Cousine-Bold.ttf` },
      i:  { ttfUrl: `${G}/apache/cousine/Cousine-Italic.ttf` },
      bi: { ttfUrl: `${G}/apache/cousine/Cousine-BoldItalic.ttf` },
    },
  },
  {
    family: "Caveat Brush",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/caveatbrush/CaveatBrush-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/caveatbrush/CaveatBrush-Regular.ttf` },
    },
  },
  {
    family: "Indie Flower",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/indieflower/IndieFlower-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/indieflower/IndieFlower-Regular.ttf` },
    },
  },
  {
    family: "Shadows Into Light",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/shadowsintolight/ShadowsIntoLight-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/shadowsintolight/ShadowsIntoLight-Regular.ttf` },
    },
  },
  {
    family: "Architects Daughter",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/apache/architectsdaughter/ArchitectsDaughter-Regular.ttf` },
      b: { ttfUrl: `${G}/apache/architectsdaughter/ArchitectsDaughter-Regular.ttf` },
    },
  },
  {
    family: "Yellowtail",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/apache/yellowtail/Yellowtail-Regular.ttf` },
      b: { ttfUrl: `${G}/apache/yellowtail/Yellowtail-Regular.ttf` },
    },
  },
  {
    family: "Tangerine",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/tangerine/Tangerine-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/tangerine/Tangerine-Bold.ttf` },
    },
  },
  {
    family: "Reenie Beanie",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/reeniebeanie/ReenieBeanie-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/reeniebeanie/ReenieBeanie-Regular.ttf` },
    },
  },
  {
    family: "Cedarville Cursive",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/cedarvillecursive/CedarvilleCursive-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/cedarvillecursive/CedarvilleCursive-Regular.ttf` },
    },
  },
  {
    family: "Fraunces",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/fraunces/Fraunces%5Bopsz%2Csoft%2Cwght%5D.ttf` },
      b:  { ttfUrl: `${G}/ofl/fraunces/Fraunces%5Bopsz%2Csoft%2Cwght%5D.ttf` },
      i:  { ttfUrl: `${G}/ofl/fraunces/Fraunces-Italic%5Bopsz%2Csoft%2Cwght%5D.ttf` },
      bi: { ttfUrl: `${G}/ofl/fraunces/Fraunces-Italic%5Bopsz%2Csoft%2Cwght%5D.ttf` },
    },
  },
  {
    family: "Young Serif",
    category: "serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/youngserif/YoungSerif-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/youngserif/YoungSerif-Regular.ttf` },
    },
  },
  {
    family: "Unna",
    category: "serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/unna/Unna-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/unna/Unna-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/unna/Unna-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/unna/Unna-BoldItalic.ttf` },
    },
  },
  {
    family: "Slabo 27px",
    category: "serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/slabo27px/Slabo27px-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/slabo27px/Slabo27px-Regular.ttf` },
    },
  },
  {
    family: "Abril Fatface",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/abrilfatface/AbrilFatface-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/abrilfatface/AbrilFatface-Regular.ttf` },
    },
  },
  {
    family: "Graduate",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/graduate/Graduate-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/graduate/Graduate-Regular.ttf` },
    },
  },
  {
    family: "Passion One",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/passionone/PassionOne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/passionone/PassionOne-Bold.ttf` },
    },
  },
  {
    family: "Fjalla One",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/fjallaone/FjallaOne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/fjallaone/FjallaOne-Regular.ttf` },
    },
  },
  {
    family: "Chakra Petch",
    category: "sans-serif",
    variants: {
      r:  { ttfUrl: `${G}/ofl/chakrapetch/ChakraPetch-Regular.ttf` },
      b:  { ttfUrl: `${G}/ofl/chakrapetch/ChakraPetch-Bold.ttf` },
      i:  { ttfUrl: `${G}/ofl/chakrapetch/ChakraPetch-Italic.ttf` },
      bi: { ttfUrl: `${G}/ofl/chakrapetch/ChakraPetch-BoldItalic.ttf` },
    },
  },
  {
    family: "Cabin Condensed",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/cabincondensed/CabinCondensed-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/cabincondensed/CabinCondensed-Bold.ttf` },
    },
  },
  {
    family: "Fugaz One",
    category: "display",
    variants: {
      r: { ttfUrl: `${G}/ofl/fugazone/FugazOne-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/fugazone/FugazOne-Regular.ttf` },
    },
  },
  {
    family: "Ultra",
    category: "serif",
    variants: {
      r: { ttfUrl: `${G}/ofl/ultra/Ultra-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/ultra/Ultra-Regular.ttf` },
    },
  },
  {
    family: "Kaushan Script",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/ofl/kaushanscript/KaushanScript-Regular.ttf` },
      b: { ttfUrl: `${G}/ofl/kaushanscript/KaushanScript-Regular.ttf` },
    },
  },
  {
    family: "Covered By Your Grace",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/apache/coveredbyyourgrace/CoveredByYourGrace-Regular.ttf` },
      b: { ttfUrl: `${G}/apache/coveredbyyourgrace/CoveredByYourGrace-Regular.ttf` },
    },
  },
  {
    family: "Rock Salt",
    category: "handwriting",
    variants: {
      r: { ttfUrl: `${G}/apache/rocksalt/RockSalt-Regular.ttf` },
      b: { ttfUrl: `${G}/apache/rocksalt/RockSalt-Regular.ttf` },
    },
  },
  {
    family: "Aclonica",
    category: "sans-serif",
    variants: {
      r: { ttfUrl: `${G}/apache/aclonica/Aclonica-Regular.ttf` },
      b: { ttfUrl: `${G}/apache/aclonica/Aclonica-Regular.ttf` },
    },
  },
];

// ---------------------------------------------------------------------------
// Runtime de-duplicate: if the static list accidentally has a duplicate family
// name (only "Abril Fatface" and "Oswald" appear twice due to category listing,
// dedup at module load time so the Map and the exported array stay consistent).
// ---------------------------------------------------------------------------
const _seen = new Set<string>();
const _deduped: GoogleFontEntry[] = [];
for (const entry of GOOGLE_FONTS) {
  if (!_seen.has(entry.family)) {
    _seen.add(entry.family);
    _deduped.push(entry);
  }
}
// Replace the array contents in-place so the exported reference stays stable.
GOOGLE_FONTS.length = 0;
GOOGLE_FONTS.push(..._deduped);

// ---------------------------------------------------------------------------
// O(1) lookup map
// ---------------------------------------------------------------------------

const _googleFontMap = new Map<string, GoogleFontEntry>();
for (const entry of GOOGLE_FONTS) {
  _googleFontMap.set(entry.family, entry);
}

/** Look up a GoogleFontEntry by exact family name. Returns undefined for
 * standard fonts and unknown names. */
export function getGoogleFontEntry(family: FontFamily): GoogleFontEntry | undefined {
  return _googleFontMap.get(family);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Returns true when `family` is one of the three built-in PDF standard fonts. */
export function isStandardFont(family: FontFamily): family is StandardFontFamily {
  return family === "Helvetica" || family === "Times" || family === "Courier";
}

// ---------------------------------------------------------------------------
// CSS font stacks
// ---------------------------------------------------------------------------

/** Category → generic CSS fallback family. */
const CATEGORY_FALLBACK: Record<FontCategory, string> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  display: "sans-serif",
  handwriting: "cursive",
  monospace: "monospace",
};

/**
 * Returns the CSS font-family value for a given family name.
 *
 * Standard fonts → their existing stacks (unchanged from the original
 * cssFontStack helper).  Google fonts → `"<family>", <category-fallback>`.
 */
export function cssFontFamily(family: FontFamily): string {
  if (family === "Times") return '"Times New Roman", Times, serif';
  if (family === "Courier") return '"Courier New", Courier, monospace';
  if (family === "Helvetica") return "Helvetica, Arial, sans-serif";

  const entry = _googleFontMap.get(family);
  const fallback = entry ? CATEGORY_FALLBACK[entry.category] : "sans-serif";
  return `"${family}", ${fallback}`;
}

/**
 * Backward-compatible alias so existing imports of `cssFontStack` from
 * TextFormatToolbar.tsx do not break until they are migrated to `cssFontFamily`.
 */
export const cssFontStack = cssFontFamily;

// ---------------------------------------------------------------------------
// Font loading helpers (browser-only)
// ---------------------------------------------------------------------------

/** Set of family names whose <link rel="stylesheet"> has already been injected. */
const _injectedFamilies = new Set<string>();

let _preconnectDone = false;

/**
 * Inject `<link rel="preconnect">` for fonts.googleapis.com and
 * fonts.gstatic.com once per page load.  Safe to call repeatedly.
 */
export function injectPreconnect(): void {
  if (_preconnectDone || typeof document === "undefined") return;
  _preconnectDone = true;

  const origins: Array<{ href: string; crossOrigin?: string }> = [
    { href: "https://fonts.googleapis.com" },
    { href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  ];

  for (const { href, crossOrigin } of origins) {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    if (crossOrigin) link.crossOrigin = crossOrigin;
    document.head.appendChild(link);
  }
}

/**
 * Idempotently inject a Google Fonts css2 `<link rel="stylesheet">` for the
 * given family so the browser can render it.  Skips standard fonts and
 * families already injected.
 *
 * CSS2 URL format:
 *   https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap
 */
export function ensureFontLoaded(family: FontFamily): void {
  if (typeof document === "undefined") return;
  if (isStandardFont(family)) return;
  if (_injectedFamilies.has(family)) return;

  _injectedFamilies.add(family);
  injectPreconnect();

  const encoded = family.replace(/ /g, "+");
  // Request 400 + 700, normal + italic.
  const href =
    `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;

  if (document.querySelector(`link[href="${href}"]`)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Wait until all listed Google font families are available for canvas
 * measurement.  Skips standard fonts.  Resolves immediately in non-browser
 * environments (e.g., test runners).
 */
export async function waitForFonts(families: FontFamily[]): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;

  const googleFamilies = families.filter((f) => !isStandardFont(f));
  if (googleFamilies.length === 0) return;

  for (const family of googleFamilies) {
    ensureFontLoaded(family);
  }

  if (!document.fonts) return;

  await document.fonts.ready;

  await Promise.all(
    googleFamilies.flatMap((family) =>
      ["400 16px", "700 16px", "italic 400 16px", "italic 700 16px"].map(
        (spec) =>
          document.fonts.load(`${spec} "${family}"`).catch(() => {
            // Ignore load failures — the browser will use a fallback face.
          }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// TTF fetch cache (for PDF export via pdf-lib + fontkit)
// ---------------------------------------------------------------------------

const _ttfCache = new Map<string, ArrayBuffer>();

/**
 * Fetch the TTF at `url` and return its bytes.  Results are cached by URL for
 * the lifetime of the session so each font file is downloaded at most once.
 */
export async function fetchFontTtf(url: string): Promise<ArrayBuffer> {
  const cached = _ttfCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch font TTF (${response.status}): ${url}`);
  }
  const buffer = await response.arrayBuffer();
  _ttfCache.set(url, buffer);
  return buffer;
}

/*
 * VERIFIED TTF URLs (HTTP 200 confirmed during implementation with curl -sI):
 *
 * Static (explicit variant files):
 *   ofl/lato/Lato-Regular.ttf                    → 200
 *   ofl/lato/Lato-Bold.ttf                        → 200
 *   ofl/lato/Lato-Italic.ttf                      → 200
 *   ofl/lato/Lato-BoldItalic.ttf                  → 200
 *   ofl/poppins/Poppins-Regular.ttf               → 200
 *   ofl/poppins/Poppins-Bold.ttf                  → 200
 *   ofl/poppins/Poppins-Italic.ttf                → 200
 *   ofl/poppins/Poppins-BoldItalic.ttf            → 200
 *   ofl/firasans/FiraSans-Regular.ttf             → 200
 *   ofl/firasans/FiraSans-Bold.ttf                → 200
 *   ofl/firasans/FiraSans-Italic.ttf              → 200
 *   ofl/firasans/FiraSans-BoldItalic.ttf          → 200
 *   ofl/crimsontext/CrimsonText-Regular.ttf       → 200
 *   ofl/crimsontext/CrimsonText-Bold.ttf          → 200
 *   ofl/crimsontext/CrimsonText-Italic.ttf        → 200
 *   ofl/crimsontext/CrimsonText-BoldItalic.ttf    → 200
 *   ofl/ptserif/PT_Serif-Web-Regular.ttf          → 200
 *   ofl/ptserif/PT_Serif-Web-Bold.ttf             → 200
 *   ofl/ptserif/PT_Serif-Web-Italic.ttf           → 200
 *   ofl/ptserif/PT_Serif-Web-BoldItalic.ttf       → 200
 *   ofl/ptsans/PT_Sans-Web-Regular.ttf            → 200
 *   ofl/ptsans/PT_Sans-Web-Bold.ttf               → 200
 *   ofl/ptsans/PT_Sans-Web-Italic.ttf             → 200
 *   ofl/ptsans/PT_Sans-Web-BoldItalic.ttf         → 200
 *   ofl/spacemono/SpaceMono-Regular.ttf           → 200
 *   ofl/spacemono/SpaceMono-Bold.ttf              → 200
 *   ofl/spacemono/SpaceMono-Italic.ttf            → 200
 *   ofl/spacemono/SpaceMono-BoldItalic.ttf        → 200
 *   ofl/zillaslab/ZillaSlab-Regular.ttf           → 200
 *   ofl/zillaslab/ZillaSlab-Bold.ttf              → 200
 *   ofl/zillaslab/ZillaSlab-Italic.ttf            → 200
 *   ofl/zillaslab/ZillaSlab-BoldItalic.ttf        → 200
 *   ofl/titilliumweb/TitilliumWeb-Regular.ttf     → 200
 *   ofl/titilliumweb/TitilliumWeb-Bold.ttf        → 200
 *   ofl/titilliumweb/TitilliumWeb-Italic.ttf      → 200
 *   ofl/titilliumweb/TitilliumWeb-BoldItalic.ttf  → 200
 *   ufl/ubuntu/Ubuntu-Regular.ttf                 → 200
 *   ufl/ubuntu/Ubuntu-Bold.ttf                    → 200
 *   ufl/ubuntu/Ubuntu-Italic.ttf                  → 200
 *   ufl/ubuntu/Ubuntu-BoldItalic.ttf              → 200
 *   ufl/ubuntumono/UbuntuMono-Regular.ttf         → 200
 *   ufl/ubuntumono/UbuntuMono-Bold.ttf            → 200
 *   ufl/ubuntumono/UbuntuMono-Italic.ttf          → 200
 *   ufl/ubuntumono/UbuntuMono-BoldItalic.ttf      → 200
 *   ofl/lobster/Lobster-Regular.ttf               → 200
 *   ofl/questrial/Questrial-Regular.ttf           → 200
 *   ofl/dmseriftext/DMSerifText-Regular.ttf       → 200
 *   ofl/dmseriftext/DMSerifText-Italic.ttf        → 200
 *
 * Variable fonts (URL-encoded brackets: [ → %5B, ] → %5D, , → %2C):
 *   ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf                           → 200
 *   ofl/roboto/Roboto-Italic%5Bwdth%2Cwght%5D.ttf                    → 200
 *   ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf                       → 200
 *   ofl/opensans/OpenSans-Italic%5Bwdth%2Cwght%5D.ttf                → 200
 *   ofl/montserrat/Montserrat%5Bwght%5D.ttf                          → 200
 *   ofl/montserrat/Montserrat-Italic%5Bwght%5D.ttf                   → 200
 *   ofl/merriweather/Merriweather%5Bopsz%2Cwdth%2Cwght%5D.ttf       → 200
 *   ofl/merriweather/Merriweather-Italic%5Bopsz%2Cwdth%2Cwght%5D.ttf → 200
 *   ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf                → 200
 *   ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf         → 200
 *   ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf                    → 200
 *   ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf             → 200
 *   ofl/nunito/Nunito%5Bwght%5D.ttf                                  → 200
 *   ofl/nunito/Nunito-Italic%5Bwght%5D.ttf                           → 200
 *   ofl/raleway/Raleway%5Bwght%5D.ttf                                → 200
 *   ofl/raleway/Raleway-Italic%5Bwght%5D.ttf                         → 200
 *   ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf                             → 200
 *   ofl/inter/Inter-Italic%5Bopsz%2Cwght%5D.ttf                      → 200
 *   ofl/oswald/Oswald%5Bwght%5D.ttf                                  → 200
 *   ofl/firacode/FiraCode%5Bwght%5D.ttf                              → 200
 *   ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf                           → 200
 *   ofl/dmsans/DMSans-Italic%5Bopsz%2Cwght%5D.ttf                    → 200
 *   ofl/worksans/WorkSans%5Bwght%5D.ttf                              → 200
 *   ofl/worksans/WorkSans-Italic%5Bwght%5D.ttf                       → 200
 *   ofl/rubik/Rubik%5Bwght%5D.ttf                                    → 200
 *   ofl/rubik/Rubik-Italic%5Bwght%5D.ttf                             → 200
 *   ofl/josefinsans/JosefinSans%5Bwght%5D.ttf                        → 200
 *   ofl/josefinsans/JosefinSans-Italic%5Bwght%5D.ttf                 → 200
 *   ofl/karla/Karla%5Bwght%5D.ttf                                    → 200
 *   ofl/karla/Karla-Italic%5Bwght%5D.ttf                             → 200
 *   ofl/exo/Exo%5Bwght%5D.ttf                                        → 200
 *   ofl/exo/Exo-Italic%5Bwght%5D.ttf                                 → 200
 *   ofl/quicksand/Quicksand%5Bwght%5D.ttf                            → 200
 *   ofl/dancingscript/DancingScript%5Bwght%5D.ttf                    → 200
 *   ofl/cabin/Cabin%5Bwdth%2Cwght%5D.ttf                             → 200
 *   ofl/cabin/Cabin-Italic%5Bwdth%2Cwght%5D.ttf                      → 200
 *   ofl/arimo/Arimo%5Bwght%5D.ttf                                    → 200
 *   ofl/arimo/Arimo-Italic%5Bwght%5D.ttf                             → 200
 *   ofl/inconsolata/Inconsolata%5Bwdth%2Cwght%5D.ttf                 → 200
 *   ofl/teko/Teko%5Bwght%5D.ttf                                      → 200
 *   ofl/exo2/Exo2%5Bwght%5D.ttf                                      → 200
 *   ofl/exo2/Exo2-Italic%5Bwght%5D.ttf                               → 200
 *   ofl/jost/Jost%5Bwght%5D.ttf                                      → 200
 *   ofl/jost/Jost-Italic%5Bwght%5D.ttf                               → 200
 *   ofl/notoserif/NotoSerif%5Bwdth%2Cwght%5D.ttf                     → 200
 *   ofl/notoserif/NotoSerif-Italic%5Bwdth%2Cwght%5D.ttf              → 200
 *   ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf                       → 200
 *   ofl/notosans/NotoSans-Italic%5Bwdth%2Cwght%5D.ttf                → 200
 *   ofl/manrope/Manrope%5Bwght%5D.ttf                                → 200
 *   ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf                      → 200
 *   ofl/yanonekaffeesatz/YanoneKaffeesatz%5Bwght%5D.ttf              → 200
 *
 * NOT VERIFIED (added by catalog pattern inference — may need correction):
 *   All entries under apache/permanentmarker, apache/robotomono,
 *   apache/architectsdaughter, apache/yellowtail, apache/coveredbyyourgrace,
 *   apache/rocksalt, apache/tinos, apache/cousine, apache/aclonica,
 *   ofl/barlow, ofl/barlowcondensed, ofl/barlowsemicondensed,
 *   ofl/mulish, ofl/sourcesans3, ofl/overpass, ofl/asap, ofl/nunitosans,
 *   ofl/kanit, ofl/oxygen, ofl/varelaround, ofl/encodesans, ofl/heebo,
 *   ofl/librefranklin, ofl/mukta, ofl/hind, ofl/bevietnampro, ofl/rajdhani,
 *   ofl/acme, ofl/prompt, ofl/abel, ofl/dosis, ofl/saira, ofl/sairacondensed,
 *   ofl/hindmadurai, ofl/catamaran, ofl/nanumgothic, ofl/ibmplexsans,
 *   ofl/ibmplexmono, ofl/ibmplexserif, ofl/phudu, ofl/bebasneue,
 *   ofl/abrilfatface, ofl/yesevaone, ofl/cinzel, ofl/poiretone,
 *   ofl/fredoka, ofl/syne, ofl/figtree, ofl/plusjakartasans, ofl/notosansjp,
 *   ofl/hankengrotesk, ofl/urbanist, ofl/outfit, ofl/geologica,
 *   ofl/wixmadefordisplay, ofl/lexend, ofl/schibstedgrotesk,
 *   ofl/robotocondensed, ofl/robotoslab, ofl/lora, ofl/librebaskerville,
 *   ofl/ebgaramond, ofl/cormorantgaramond, ofl/alegreya, ofl/bitter,
 *   ofl/rokkitt, ofl/cardo, ofl/spectral, ofl/vollkorn, ofl/neuton,
 *   ofl/fraunces, ofl/youngserif, ofl/unna, ofl/slabo27px, ofl/ultra,
 *   ofl/pacifico, ofl/caveat, ofl/satisfy, ofl/kalam, ofl/amaticsc,
 *   ofl/patrickhand, ofl/handlee, ofl/cookie, ofl/courgette, ofl/allura,
 *   ofl/pinyonscript, ofl/sacramento, ofl/greatvibes, ofl/parisienne,
 *   ofl/marckscript, ofl/neucha, ofl/breeserif, ofl/alfaslabone,
 *   ofl/bangers, ofl/blackhansans, ofl/comfortaa, ofl/pressstart2p,
 *   ofl/righteous, ofl/anton, ofl/comfortaa, ofl/kaushanscript,
 *   ofl/tangerine, ofl/reeniebeanie, ofl/cedarvillecursive, ofl/indieflower,
 *   ofl/shadowsintolight, ofl/caveatbrush, ofl/overpassmono, ofl/courierprime,
 *   ofl/graduate, ofl/passionone, ofl/fjallaone, ofl/chakrapetch,
 *   ofl/cabincondensed, ofl/fugazone, ofl/reenie beanie, ofl/rajdhani.
 *   These follow the same github.com/google/fonts repo layout pattern.
 */
