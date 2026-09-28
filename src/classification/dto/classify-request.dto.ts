import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type {
  CandidateInput,
  LinkedInProfileData,
} from "../../types/candidate";

class LinkedInProfileDataDto implements LinkedInProfileData {
  @IsString()
  profileUrl!: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  about?: string;

  @IsArray()
  experience!: LinkedInProfileData["experience"];

  @IsOptional()
  @IsArray()
  education?: LinkedInProfileData["education"];

  @IsOptional()
  @IsArray()
  skills?: string[];
}

class CandidateInputDto implements Omit<CandidateInput, "profileText"> {
  @IsOptional()
  @IsString()
  externalId?: string;

  @IsIn(["manual", "linkedin", "email"])
  source!: "manual" | "linkedin" | "email";

  // Optional here even though CandidateInput requires it — the LinkedIn path
  // only naturally has structuredProfile; ClassificationService fills this in
  // via toProfileText() when it's absent and structuredProfile is present.
  @IsOptional()
  @IsString()
  profileText?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LinkedInProfileDataDto)
  structuredProfile?: LinkedInProfileDataDto;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class ClassifyRequestDto {
  @IsString()
  @IsNotEmpty()
  roleId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => CandidateInputDto)
  candidate!: CandidateInputDto;
}
