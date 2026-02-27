// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Escrow} from "../src/Escrow.sol";

/// Env:
/// - DEPLOYER_PRIVATE_KEY
/// - ORACLE_ADDRESS (optional; defaults to deployer)
///
/// Usage (Base Sepolia example):
/// forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address oracle = deployer;
        if (vm.envOr("ORACLE_ADDRESS", address(0)) != address(0)) {
            oracle = vm.envAddress("ORACLE_ADDRESS");
        }

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();
        Escrow escrow = new Escrow(address(usdc), oracle);

        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("oracle", oracle);
        console2.log("MockUSDC", address(usdc));
        console2.log("Escrow", address(escrow));
    }
}
