"use client";
import { createContext, useContext } from "react";
export const ProjectReadOnly = createContext(false);
export const useProjectReadOnly = () => useContext(ProjectReadOnly);
