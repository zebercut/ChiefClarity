import { Redirect } from "expo-router";
import React, { useContext } from "react";
import { ConfigContext } from "./_layout";
import SetupScreen from "./setup";

export default function Index() {
  const { config } = useContext(ConfigContext);

  if (!config) return <SetupScreen />;
  return <Redirect href="/(tabs)/chat" />;
}
